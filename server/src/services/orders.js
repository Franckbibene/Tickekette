import crypto from 'node:crypto';
import { all, get, run, tx } from '../db.js';
import { clock } from '../clock.js';
import { config } from '../config.js';
import { HttpError, badRequest, conflict, notFound } from '../errors.js';
import { LIMITS, email, integer, text } from '../validation.js';
import {
  cancelDeadline,
  confirmHeldSeats,
  getEvent,
  holdSeats,
  releaseSeats,
  salesOpen,
  ticketTypesOf,
  transferAllowed,
} from './inventory.js';
import { mailExpired, mailTransferInstructions, mailWaitlistOfferExpired } from './mailer.js';
import { issueTickets, refund } from './payments.js';
import { processWaitlist } from './waitlist.js';

const PAYMENT_METHODS = ['card', 'transfer'];

function randomReference() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return `TKK-${[...crypto.randomBytes(6)].map((b) => alphabet[b % alphabet.length]).join('')}`;
}

// Normalise le panier envoyé par le navigateur. Seuls l'identifiant du type de place
// et la quantité sont lus : tout prix ou montant éventuellement envoyé est ignoré.
function parseItems(rawItems, event) {
  const validTypes = new Set(ticketTypesOf(event.id).map((t) => t.id));
  if (!Array.isArray(rawItems) || rawItems.length > validTypes.size) {
    throw badRequest('invalid_items', 'Panier invalide.');
  }
  const items = [];
  for (const raw of rawItems) {
    const ticketTypeId = Number(raw?.ticketTypeId);
    const quantity = integer(raw?.quantity, { field: 'Nombre de places', min: 0, max: event.max_per_order });
    if (!validTypes.has(ticketTypeId) || items.some((i) => i.ticketTypeId === ticketTypeId)) {
      throw badRequest('invalid_ticket_type', 'Type de place invalide.');
    }
    if (quantity > 0) items.push({ ticketTypeId, quantity });
  }
  const total = items.reduce((sum, i) => sum + i.quantity, 0);
  if (total === 0) throw badRequest('empty_order', 'Choisissez au moins une place.');
  if (total > event.max_per_order) throw badRequest('too_many', `${event.max_per_order} places maximum par commande.`);
  return items;
}

export function createOrder(eventId, input, idempotencyKey = null) {
  const event = getEvent(eventId);
  if (!event || event.status !== 'published') throw notFound('Événement introuvable.');
  if (!salesOpen(event)) throw conflict('sales_closed', 'La vente est terminée pour cet événement.');

  const buyerName = text(input.buyerName, { field: 'Nom', max: LIMITS.name });
  const buyerEmail = email(input.buyerEmail);
  const paymentMethod = PAYMENT_METHODS.includes(input.paymentMethod) ? input.paymentMethod : 'card';
  if (paymentMethod === 'transfer' && !transferAllowed(event)) {
    throw conflict('transfer_closed', 'Le paiement par virement n’est plus possible pour cet événement.');
  }
  const items = parseItems(input.items, event);

  return tx(() => {
    // Même clé d'idempotence (double clic, nouvel essai après coupure) : même commande.
    if (idempotencyKey) {
      const existing = get('SELECT * FROM orders WHERE idempotency_key = ?', idempotencyKey);
      if (existing) {
        if (existing.event_id !== event.id) throw conflict('idempotency_conflict', 'Requête déjà utilisée.');
        return { order: existing, replayed: true };
      }
    }
    sweepExpired();
    const order = createOrderInTx({
      event,
      items,
      buyerName,
      buyerEmail,
      paymentMethod,
      locale: input.locale === 'en' ? 'en' : 'fr',
      idempotencyKey,
    });
    return { order, replayed: false };
  });
}

// Doit être appelée dans une transaction.
export function createOrderInTx({
  event,
  items,
  buyerName,
  buyerEmail,
  paymentMethod,
  locale,
  holdMinutes = null,
  waitlistEntryId = null,
  idempotencyKey = null,
}) {
  const now = clock.now();
  const lines = holdSeats(event, items, now);
  const minutes = holdMinutes ?? config.holdMinutes[paymentMethod];
  const expiresAt = new Date(Math.min(now.getTime() + minutes * 60_000, Date.parse(event.starts_at)));
  const totalCents = lines.reduce((sum, l) => sum + l.quantity * l.unitPriceCents, 0);
  const { lastInsertRowid } = run(
    `INSERT INTO orders (token, reference, event_id, collective_id, buyer_name, buyer_email, locale,
       payment_method, status, total_cents, expires_at, waitlist_entry_id, idempotency_key, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?)`,
    crypto.randomBytes(18).toString('base64url'),
    randomReference(),
    event.id,
    event.collective_id,
    buyerName,
    buyerEmail,
    locale,
    paymentMethod,
    totalCents,
    expiresAt.toISOString(),
    waitlistEntryId,
    idempotencyKey,
    now.toISOString(),
  );
  const orderId = Number(lastInsertRowid);
  for (const l of lines) {
    run(
      'INSERT INTO order_items (order_id, ticket_type_id, quantity, unit_price_cents, is_early) VALUES (?, ?, ?, ?, ?)',
      orderId,
      l.ticketTypeId,
      l.quantity,
      l.unitPriceCents,
      l.isEarly,
    );
  }
  const order = get('SELECT * FROM orders WHERE id = ?', orderId);

  if (totalCents === 0) {
    // Place gratuite (invitation) : pas de paiement, billets émis immédiatement.
    confirmHeldSeats(orderId);
    issueTickets(order, event);
  } else if (paymentMethod === 'transfer') {
    const collective = get('SELECT * FROM collectives WHERE id = ?', event.collective_id);
    mailTransferInstructions(order, event, collective);
  }
  return get('SELECT * FROM orders WHERE id = ?', orderId);
}

function expireOrder(order) {
  const current = get('SELECT * FROM orders WHERE id = ?', order.id);
  if (current.status !== 'pending') return;
  const event = getEvent(current.event_id);
  const touched = releaseSeats(current);
  run("UPDATE orders SET status = 'expired', closed_at = ? WHERE id = ?", clock.nowIso(), current.id);
  if (current.waitlist_entry_id) {
    run("UPDATE waitlist_entries SET status = 'expired' WHERE id = ?", current.waitlist_entry_id);
    mailWaitlistOfferExpired(current, event);
  } else {
    mailExpired(current, event);
  }
  for (const id of touched) processWaitlist(id);
}

// Libère les réservations non payées dont le délai est dépassé.
// Appelée périodiquement et avant chaque achat : les places ne restent jamais bloquées.
let sweeping = false;
export function sweepExpired() {
  if (sweeping) return 0;
  sweeping = true;
  try {
    return tx(() => {
      const now = clock.nowIso();
      const expired = all("SELECT * FROM orders WHERE status = 'pending' AND expires_at <= ? ORDER BY id", now);
      for (const order of expired) expireOrder(order);
      // (H8) La liste d'attente se ferme au début de l'événement.
      run(
        `UPDATE waitlist_entries SET status = 'expired'
         WHERE status = 'waiting' AND event_id IN (SELECT id FROM events WHERE starts_at <= ?)`,
        now,
      );
      return expired.length;
    });
  } finally {
    sweeping = false;
  }
}

export function cancelOrderByBuyer(token) {
  return tx(() => {
    const order = get('SELECT * FROM orders WHERE token = ?', token);
    if (!order) throw notFound('Commande introuvable.');
    const event = getEvent(order.event_id);

    if (order.status === 'pending') {
      const touched = releaseSeats(order);
      run("UPDATE orders SET status = 'cancelled', closed_at = ? WHERE id = ?", clock.nowIso(), order.id);
      if (order.waitlist_entry_id) run("UPDATE waitlist_entries SET status = 'declined' WHERE id = ?", order.waitlist_entry_id);
      for (const id of touched) processWaitlist(id);
      return;
    }

    if (order.status !== 'paid') throw conflict('not_cancellable', 'Cette commande ne peut plus être annulée.');
    if (event.status === 'cancelled') throw conflict('not_cancellable', 'L’événement est déjà annulé et remboursé.');
    if (clock.now() > cancelDeadline(event)) throw conflict('cancel_deadline_passed', 'Le délai d’annulation est dépassé.');
    const entered = get('SELECT COUNT(*) AS n FROM tickets WHERE order_id = ? AND entered_at IS NOT NULL', order.id);
    if (entered.n > 0) throw conflict('already_used', 'Un billet de cette commande a déjà été scanné.');

    const touched = releaseSeats(order);
    run("UPDATE tickets SET status = 'cancelled' WHERE order_id = ?", order.id);
    refund(order, event, 'buyer_cancelled');
    // (5.5) La place libérée va d'abord à la liste d'attente, puis retourne en vente.
    for (const id of touched) processWaitlist(id);
  });
}

// Annulation de l'événement par l'organisateur : tout le monde est remboursé.
export function cancelEvent(eventId) {
  tx(() => {
    const event = getEvent(eventId);
    if (event.status === 'cancelled') return;
    run("UPDATE events SET status = 'cancelled' WHERE id = ?", eventId);
    const cancelled = { ...event, status: 'cancelled' };
    for (const order of all("SELECT * FROM orders WHERE event_id = ? AND status IN ('pending', 'paid')", eventId)) {
      releaseSeats(order);
      if (order.status === 'pending') {
        run("UPDATE orders SET status = 'cancelled', closed_at = ? WHERE id = ?", clock.nowIso(), order.id);
      } else {
        run("UPDATE tickets SET status = 'cancelled' WHERE order_id = ?", order.id);
        refund(order, cancelled, 'event_cancelled');
      }
    }
    run("UPDATE waitlist_entries SET status = 'expired' WHERE event_id = ? AND status IN ('waiting', 'offered')", eventId);
  });
}

export function assertOrderPayable(order) {
  if (order.status !== 'pending') throw conflict('not_payable', 'Cette commande n’est plus en attente de paiement.');
  if (clock.nowIso() >= order.expires_at) throw conflict('expired', 'La réservation a expiré.');
  if (order.payment_method !== 'card') throw new HttpError(400, 'wrong_method', 'Commande à régler par virement.');
}
