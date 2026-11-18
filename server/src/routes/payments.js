import crypto from 'node:crypto';
import express, { Router } from 'express';
import { get, run, tx } from '../db.js';
import { clock } from '../clock.js';
import { config } from '../config.js';
import { HttpError, badRequest, conflict, notFound } from '../errors.js';
import { recordPayment } from '../services/payments.js';
import { routeToken } from '../validation.js';

const WEBHOOK_BODY_LIMIT = '100kb';
// Garde-fou sur les montants d'une notification (10 M€) : un montant hors bornes est ignoré.
const MAX_AMOUNT_CENTS = 1_000_000_00;

const sign = (body) => crypto.createHmac('sha256', config.webhookSecret).update(body).digest('hex');

function hasValidSignature(rawBody, received) {
  const expected = Buffer.from(sign(rawBody));
  const given = Buffer.from(String(received ?? ''));
  return expected.length === given.length && crypto.timingSafeEqual(expected, given);
}

function parsePaymentEvent(rawBody) {
  let event;
  try {
    event = JSON.parse(rawBody.toString('utf8'));
  } catch {
    throw badRequest('invalid_json', 'Notification illisible.');
  }
  const data = event?.data ?? {};
  if (typeof event?.id !== 'string' || typeof event?.type !== 'string') throw badRequest('invalid_event', 'Notification invalide.');
  const inBounds = (n) => Number.isInteger(n) && n >= 0 && n <= MAX_AMOUNT_CENTS;
  return {
    id: event.id.slice(0, 100),
    type: event.type.slice(0, 50),
    paymentId: typeof data.paymentId === 'string' ? data.paymentId.slice(0, 100) : null,
    orderToken: typeof data.orderToken === 'string' ? data.orderToken : null,
    amountCents: inBounds(data.amountCents) ? data.amountCents : null,
    feeCents: inBounds(data.feeCents) ? data.feeCents : 0,
  };
}

// ---------------------------------------------------------------------------
// Notifications du prestataire de paiement (webhook)
// ---------------------------------------------------------------------------
// Authentifiées par signature HMAC (le prestataire n'a pas de session).
// Deux protections contre les notifications en double (5.3) :
// 1. l'identifiant de notification est enregistré une seule fois (webhook_events) ;
// 2. l'identifiant de paiement est unique (payments), même si le prestataire
//    renvoie le même paiement sous un autre identifiant de notification.
export const webhookRouter = Router();

webhookRouter.post('/payment', express.raw({ type: '*/*', limit: WEBHOOK_BODY_LIMIT }), (req, res) => {
  const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
  if (!hasValidSignature(raw, req.get('x-mock-signature'))) throw new HttpError(400, 'bad_signature', 'Signature invalide.');
  const event = parsePaymentEvent(raw);
  const outcome = tx(() => {
    const inserted = run(
      'INSERT OR IGNORE INTO webhook_events (id, type, received_at) VALUES (?, ?, ?)',
      event.id,
      event.type,
      clock.nowIso(),
    );
    if (inserted.changes === 0) return 'duplicate_notification';
    if (event.type !== 'payment.succeeded' || !event.paymentId || event.amountCents === null) return 'ignored';
    const order = event.orderToken ? get('SELECT id FROM orders WHERE token = ?', event.orderToken) : null;
    if (!order) return 'unknown_order';
    const { status } = recordPayment(order.id, {
      provider: 'mockpay',
      providerPaymentId: event.paymentId,
      amountCents: event.amountCents,
      feeCents: event.feeCents,
    });
    run('UPDATE webhook_events SET result = ? WHERE id = ?', status, event.id);
    return status;
  });
  res.json({ received: true, outcome });
});

// ---------------------------------------------------------------------------
// Prestataire de paiement SIMULÉ (démo). Monté uniquement si PAYMENT_PROVIDER=mock,
// ce que la configuration interdit en production : sinon n'importe qui pourrait
// déclencher un « paiement » et obtenir des billets gratuits.
// ---------------------------------------------------------------------------
export const mockProviderRouter = Router();

const sessionById = (id) => {
  const session = get('SELECT * FROM mock_provider_sessions WHERE id = ?', routeToken(id));
  if (!session) throw notFound('Session de paiement introuvable.');
  return session;
};

mockProviderRouter.get('/sessions/:id', (req, res) => {
  const s = sessionById(req.params.id);
  res.json({ id: s.id, label: s.label, amountCents: s.amount_cents, status: s.status, returnUrl: `/commande/${s.order_token}` });
});

mockProviderRouter.post('/sessions/:id/pay', async (req, res) => {
  const session = sessionById(req.params.id);
  // Passage atomique open -> paid : deux clics simultanés ne paient pas deux fois.
  const paymentId = `pi_${crypto.randomBytes(10).toString('hex')}`;
  const claimed = run(
    "UPDATE mock_provider_sessions SET status = 'paid', payment_id = ? WHERE id = ? AND status = 'open'",
    paymentId,
    session.id,
  );
  if (claimed.changes !== 1) throw conflict('already_paid', 'Cette session est déjà payée.');

  const feeCents = Math.round((session.amount_cents * config.cardFee.percent) / 100) + config.cardFee.fixedCents;
  const body = JSON.stringify({
    id: `evt_${crypto.randomBytes(10).toString('hex')}`,
    type: 'payment.succeeded',
    data: { paymentId, orderToken: session.order_token, amountCents: session.amount_cents, feeCents },
  });
  const deliver = () =>
    fetch(`${config.apiUrl}/api/webhooks/payment`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-mock-signature': sign(body) },
      body,
      signal: AbortSignal.timeout(5000),
    })
      .then((r) => r.json())
      .then((r) => r.outcome ?? 'error')
      .catch(() => 'error');

  // Comme le vrai prestataire du client, on peut envoyer la notification deux fois,
  // en même temps, pour démontrer qu'un seul lot de billets est émis.
  const copies = req.body?.duplicateNotification === false ? 1 : 2;
  const deliveries = await Promise.all(Array.from({ length: copies }, deliver));
  res.json({ returnUrl: `/commande/${session.order_token}`, deliveries });
});
