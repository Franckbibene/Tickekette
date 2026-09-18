import crypto from 'node:crypto';
import express, { Router } from 'express';
import { get, run, tx } from '../db.js';
import { clock } from '../clock.js';
import { config } from '../config.js';
import { HttpError, conflict, notFound } from '../errors.js';
import { recordPayment } from '../services/sales.js';

const sign = (body) => crypto.createHmac('sha256', config.webhookSecret).update(body).digest('hex');

// ---------------------------------------------------------------------------
// Notifications du prestataire de paiement (webhook)
// ---------------------------------------------------------------------------
// Deux protections contre les notifications en double (5.3) :
// 1. l'identifiant de notification est enregistré une seule fois (webhook_events) ;
// 2. l'identifiant de paiement est unique (payments), même si le prestataire
//    renvoie le même paiement sous un autre identifiant de notification.
export const webhookRouter = Router();

webhookRouter.post('/payment', express.raw({ type: '*/*', limit: '100kb' }), (req, res) => {
  const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
  const expected = Buffer.from(sign(raw));
  const received = Buffer.from(String(req.get('x-mock-signature') ?? ''));
  if (expected.length !== received.length || !crypto.timingSafeEqual(expected, received)) {
    throw new HttpError(400, 'bad_signature', 'Signature invalide.');
  }
  const event = JSON.parse(raw.toString('utf8'));
  const outcome = tx(() => {
    const inserted = run(
      'INSERT OR IGNORE INTO webhook_events (id, type, received_at) VALUES (?, ?, ?)',
      String(event.id),
      String(event.type),
      clock.nowIso(),
    );
    if (inserted.changes === 0) return 'duplicate_notification';
    if (event.type !== 'payment.succeeded') return 'ignored';
    const order = get('SELECT id FROM orders WHERE token = ?', String(event.data?.orderToken));
    if (!order) return 'unknown_order';
    const { status } = recordPayment(order.id, {
      provider: 'mockpay',
      providerPaymentId: String(event.data.paymentId),
      amountCents: Number(event.data.amountCents),
      feeCents: Number(event.data.feeCents ?? 0),
    });
    run('UPDATE webhook_events SET result = ? WHERE id = ?', status, String(event.id));
    return status;
  });
  res.json({ received: true, outcome });
});

// ---------------------------------------------------------------------------
// Prestataire de paiement simulé (à remplacer par Stripe, SumUp… en production)
// ---------------------------------------------------------------------------
export const mockProviderRouter = Router();

const sessionById = (id) => {
  const session = get('SELECT * FROM mock_provider_sessions WHERE id = ?', String(id));
  if (!session) throw notFound('Session de paiement introuvable.');
  return session;
};

mockProviderRouter.get('/sessions/:id', (req, res) => {
  const s = sessionById(req.params.id);
  res.json({ id: s.id, label: s.label, amountCents: s.amount_cents, status: s.status, returnUrl: `/commande/${s.order_token}` });
});

mockProviderRouter.post('/sessions/:id/pay', async (req, res) => {
  const session = sessionById(req.params.id);
  if (session.status !== 'open') throw conflict('already_paid', 'Cette session est déjà payée.');
  const paymentId = `pi_${crypto.randomBytes(10).toString('hex')}`;
  run("UPDATE mock_provider_sessions SET status = 'paid', payment_id = ? WHERE id = ?", paymentId, session.id);

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
    })
      .then((r) => r.json())
      .then((r) => r.outcome)
      .catch((err) => `error: ${err.message}`);

  // Comme le vrai prestataire du client, on peut envoyer la notification deux fois,
  // en même temps, pour démontrer qu'un seul lot de billets est émis.
  const copies = req.body?.duplicateNotification === false ? 1 : 2;
  const deliveries = await Promise.all(Array.from({ length: copies }, deliver));
  res.json({ returnUrl: `/commande/${session.order_token}`, deliveries });
});
