import crypto from 'node:crypto';
import { all, get, run, tx } from '../db.js';
import { clock } from '../clock.js';
import { config } from '../config.js';
import { HttpError, badRequest, conflict, notFound } from '../errors.js';
import { newTicketCode } from './tickets.js';
import {
  mailExpired,
  mailRefund,
  mailTickets,
  mailTransferInstructions,
  mailWaitlistJoined,
  mailWaitlistOffer,
  mailWaitlistOfferExpired,
} from './mailer.js';

const HOUR = 3_600_000;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const getEvent = (id) => get('SELECT * FROM events WHERE id = ?', id);
export const ticketTypesOf = (eventId) =>
  all('SELECT * FROM ticket_types WHERE event_id = ? ORDER BY position, id', eventId);
export const orderItemsOf = (orderId) =>
  all(
    `SELECT oi.*, tt.name AS ticket_type_name FROM order_items oi
     JOIN ticket_types tt ON tt.id = oi.ticket_type_id WHERE oi.order_id = ? ORDER BY oi.id`,
    orderId,
  );

// ---------------------------------------------------------------------------
// Prix et disponibilités
// ---------------------------------------------------------------------------

// (H1) Le tarif early s'arrête à sa date limite OU quand son quota est atteint.
// Les places early font partie du quota du type de place (stock commun).
export function pricing(tt, now = clock.now()) {
  const earlyActive =
    tt.early_price_cents != null &&
    tt.early_until != null &&
    now.toISOString() < tt.early_until &&
    (tt.early_quota == null || tt.early_used < tt.early_quota);
  return {
    earlyActive,
    earlyPriceCents: earlyActive ? tt.early_price_cents : null,
    earlyRemaining: earlyActive && tt.early_quota != null ? tt.early_quota - tt.early_used : null,
    priceCents: tt.price_cents,
    available: Math.max(0, tt.quota - tt.sold - tt.held),
  };
}

// (H4) Le virement n'est proposé que jusqu'à 72 h avant l'événement.
export const transferAllowed = (event, now = clock.now()) =>
  now.getTime() <= Date.parse(event.starts_at) - config.transferClosesHoursBefore * HOUR;

// (H9) Annulation possible jusqu'à N heures avant, N réglable par événement.
export const cancelDeadline = (event) => new Date(Date.parse(event.starts_at) - event.cancel_deadline_hours * HOUR);

// ---------------------------------------------------------------------------
// Création de commande
// ---------------------------------------------------------------------------

function randomReference() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return `TKK-${[...crypto.randomBytes(6)].map((b) => alphabet[b % alphabet.length]).join('')}`;
}

export function createOrder(eventId, input) {
  const event = getEvent(eventId);
  if (!event || event.status !== 'published') throw notFound('Événement introuvable.');
  const now = clock.now();
  if (now.toISOString() >= event.starts_at) throw conflict('sales_closed', 'La vente est terminée pour cet événement.');

  const buyerName = String(input.buyerName ?? '').trim();
  const buyerEmail = String(input.buyerEmail ?? '').trim().toLowerCase();
  if (!buyerName || buyerName.length > 120) throw badRequest('invalid_name', 'Indiquez votre nom.');
  if (!EMAIL_RE.test(buyerEmail)) throw badRequest('invalid_email', 'Adresse e-mail invalide.');
  const paymentMethod = input.paymentMethod === 'transfer' ? 'transfer' : 'card';
  if (paymentMethod === 'transfer' && !transferAllowed(event, now)) {
    throw conflict('transfer_closed', 'Le paiement par virement n’est plus possible pour cet événement.');
  }

  const types = new Set(ticketTypesOf(eventId).map((t) => t.id));
  const items = [];
  let total = 0;
  for (const raw of Array.isArray(input.items) ? input.items : []) {
    const ticketTypeId = Number(raw.ticketTypeId);
    const quantity = Number(raw.quantity);
    if (!Number.isInteger(quantity) || quantity < 0) throw badRequest('invalid_quantity', 'Quantité invalide.');
    if (quantity === 0) continue;
    if (!types.has(ticketTypeId) || items.some((i) => i.ticketTypeId === ticketTypeId)) {
      throw badRequest('invalid_ticket_type', 'Type de place invalide.');
    }
    items.push({ ticketTypeId, quantity });
    total += quantity;
  }
  if (total === 0) throw badRequest('empty_order', 'Choisissez au moins une place.');
  if (total > event.max_per_order) {
    throw badRequest('too_many', `${event.max_per_order} places maximum par commande.`);
  }

  return tx(() => {
    sweepExpired();
    return createOrderInTx({
      event,
      items,
      buyerName,
      buyerEmail,
      paymentMethod,
      locale: input.locale === 'en' ? 'en' : 'fr',
    });
  });
}

// Doit être appelée dans une transaction.
function createOrderInTx({ event, items, buyerName, buyerEmail, paymentMethod, locale, holdMinutes, waitlistEntryId = null }) {
  const now = clock.now();
  const lines = [];
  for (const { ticketTypeId, quantity } of items) {
    // Réservation atomique : la ligne n'est modifiée que s'il reste assez de places.
    // Si deux personnes visent la dernière place, une seule mise à jour réussit.
    const held = run(
      'UPDATE ticket_types SET held = held + ? WHERE id = ? AND event_id = ? AND sold + held + ? <= quota',
      quantity,
      ticketTypeId,
      event.id,
      quantity,
    );
    const tt = get('SELECT * FROM ticket_types WHERE id = ?', ticketTypeId);
    if (held.changes !== 1) {
      const available = Math.max(0, tt.quota - tt.sold - tt.held);
      throw conflict('sold_out', `Plus assez de places « ${tt.name} » (il en reste ${available}).`, {
        ticketTypeId,
        available,
      });
    }
    const p = pricing(tt, now);
    let early = 0;
    if (p.earlyActive) {
      early = p.earlyRemaining == null ? quantity : Math.min(quantity, p.earlyRemaining);
      run('UPDATE ticket_types SET early_used = early_used + ? WHERE id = ?', early, ticketTypeId);
    }
    if (early > 0) lines.push({ ticketTypeId, quantity: early, unit: tt.early_price_cents, isEarly: 1 });
    if (quantity > early) lines.push({ ticketTypeId, quantity: quantity - early, unit: tt.price_cents, isEarly: 0 });
  }

  const minutes = holdMinutes ?? config.holdMinutes[paymentMethod];
  const expiresAt = new Date(Math.min(now.getTime() + minutes * 60_000, Date.parse(event.starts_at)));
  const totalCents = lines.reduce((sum, l) => sum + l.quantity * l.unit, 0);
  const { lastInsertRowid } = run(
    `INSERT INTO orders (token, reference, event_id, collective_id, buyer_name, buyer_email, locale,
       payment_method, status, total_cents, expires_at, waitlist_entry_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?)`,
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
    now.toISOString(),
  );
  const orderId = Number(lastInsertRowid);
  for (const l of lines) {
    run(
      'INSERT INTO order_items (order_id, ticket_type_id, quantity, unit_price_cents, is_early) VALUES (?, ?, ?, ?, ?)',
      orderId,
      l.ticketTypeId,
      l.quantity,
      l.unit,
      l.isEarly,
    );
  }
  const order = get('SELECT * FROM orders WHERE id = ?', orderId);

  if (totalCents === 0) {
    // Place gratuite (invitation) : pas de paiement, billets émis immédiatement.
    issueTickets(order, event);
  } else if (paymentMethod === 'transfer') {
    const collective = get('SELECT * FROM collectives WHERE id = ?', event.collective_id);
    mailTransferInstructions(order, event, collective);
  }
  return get('SELECT * FROM orders WHERE id = ?', orderId);
}

// ---------------------------------------------------------------------------
// Libération des places
// ---------------------------------------------------------------------------

// Rend au stock les places d'une commande. Retourne les types de place concernés.
function releaseStock(order) {
  const touched = new Set();
  for (const it of all('SELECT * FROM order_items WHERE order_id = ?', order.id)) {
    if (order.status === 'pending') {
      run('UPDATE ticket_types SET held = held - ? WHERE id = ?', it.quantity, it.ticket_type_id);
      // (H1) Une réservation early jamais payée rend sa place early.
      if (it.is_early) run('UPDATE ticket_types SET early_used = MAX(0, early_used - ?) WHERE id = ?', it.quantity, it.ticket_type_id);
    } else if (order.status === 'paid') {
      // (H1) Une place early payée puis annulée revient au tarif normal.
      run('UPDATE ticket_types SET sold = sold - ? WHERE id = ?', it.quantity, it.ticket_type_id);
    }
    touched.add(it.ticket_type_id);
  }
  return touched;
}

function expireOrder(order) {
  const current = get('SELECT * FROM orders WHERE id = ?', order.id);
  if (current.status !== 'pending') return;
  const event = getEvent(current.event_id);
  const touched = releaseStock(current);
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
// Appelée toutes les 10 s et avant chaque achat : les places ne restent jamais bloquées.
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

// ---------------------------------------------------------------------------
// Liste d'attente
// ---------------------------------------------------------------------------

// Propose les places libres aux personnes en attente, dans l'ordre d'inscription.
// Les places sont réservées pour la personne avant d'être visibles du public :
// une place libérée ne repart en vente que si la liste d'attente est vide.
// (H6) Si la première personne veut plus de places qu'il n'en reste, on lui propose ce qui reste.
export function processWaitlist(ticketTypeId) {
  tx(() => {
    const tt = get('SELECT * FROM ticket_types WHERE id = ?', ticketTypeId);
    const event = getEvent(tt.event_id);
    if (event.status !== 'published' || clock.nowIso() >= event.starts_at) return;
    let available = tt.quota - tt.sold - tt.held;
    while (available > 0) {
      const entry = get(
        "SELECT * FROM waitlist_entries WHERE ticket_type_id = ? AND status = 'waiting' ORDER BY id LIMIT 1",
        ticketTypeId,
      );
      if (!entry) break;
      const quantity = Math.min(entry.quantity, available);
      const order = createOrderInTx({
        event,
        items: [{ ticketTypeId, quantity }],
        buyerName: entry.name,
        buyerEmail: entry.email,
        paymentMethod: 'card',
        locale: entry.locale,
        holdMinutes: config.waitlistOfferMinutes,
        waitlistEntryId: entry.id,
      });
      run(
        "UPDATE waitlist_entries SET status = 'offered', offer_order_id = ?, offered_at = ? WHERE id = ?",
        order.id,
        clock.nowIso(),
        entry.id,
      );
      if (order.status === 'pending') mailWaitlistOffer(order, event, quantity, entry.quantity);
      available -= quantity;
    }
  });
}

export function joinWaitlist(eventId, input) {
  return tx(() => {
    sweepExpired();
    const event = getEvent(eventId);
    if (!event || event.status !== 'published') throw notFound('Événement introuvable.');
    if (clock.nowIso() >= event.starts_at) throw conflict('sales_closed', 'L’événement a commencé.');
    const tt = get('SELECT * FROM ticket_types WHERE id = ? AND event_id = ?', Number(input.ticketTypeId), eventId);
    if (!tt) throw badRequest('invalid_ticket_type', 'Type de place invalide.');
    if (tt.quota - tt.sold - tt.held > 0) {
      throw conflict('seats_available', 'Il reste des places : vous pouvez les acheter directement.');
    }
    const name = String(input.name ?? '').trim();
    const email = String(input.email ?? '').trim().toLowerCase();
    const quantity = Number(input.quantity ?? 1);
    if (!name) throw badRequest('invalid_name', 'Indiquez votre nom.');
    if (!EMAIL_RE.test(email)) throw badRequest('invalid_email', 'Adresse e-mail invalide.');
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > event.max_per_order) {
      throw badRequest('invalid_quantity', `Entre 1 et ${event.max_per_order} places.`);
    }
    const existing = get(
      "SELECT id FROM waitlist_entries WHERE ticket_type_id = ? AND email = ? AND status IN ('waiting', 'offered')",
      tt.id,
      email,
    );
    if (existing) throw conflict('already_registered', 'Cette adresse est déjà sur la liste d’attente.');
    const { lastInsertRowid } = run(
      `INSERT INTO waitlist_entries (event_id, ticket_type_id, name, email, quantity, locale, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      eventId,
      tt.id,
      name,
      email,
      quantity,
      input.locale === 'en' ? 'en' : 'fr',
      clock.nowIso(),
    );
    const entry = get('SELECT * FROM waitlist_entries WHERE id = ?', Number(lastInsertRowid));
    const { position } = get(
      "SELECT COUNT(*) AS position FROM waitlist_entries WHERE ticket_type_id = ? AND status = 'waiting' AND id <= ?",
      tt.id,
      entry.id,
    );
    mailWaitlistJoined(entry, event, tt.name, position);
    return { position };
  });
}

// ---------------------------------------------------------------------------
// Paiement
// ---------------------------------------------------------------------------

function issueTickets(order, event) {
  const now = clock.nowIso();
  run("UPDATE orders SET status = 'paid', paid_at = ? WHERE id = ?", now, order.id);
  for (const it of orderItemsOf(order.id)) {
    for (let i = 0; i < it.quantity; i++) {
      run(
        `INSERT INTO tickets (code, order_id, event_id, ticket_type_id, holder_name, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        newTicketCode(),
        order.id,
        event.id,
        it.ticket_type_id,
        order.buyer_name,
        now,
      );
    }
  }
  if (order.waitlist_entry_id) run("UPDATE waitlist_entries SET status = 'converted' WHERE id = ?", order.waitlist_entry_id);
  const tickets = all(
    `SELECT t.code, tt.name AS ticket_type_name FROM tickets t
     JOIN ticket_types tt ON tt.id = t.ticket_type_id WHERE t.order_id = ? ORDER BY t.id`,
    order.id,
  );
  mailTickets(get('SELECT * FROM orders WHERE id = ?', order.id), event, tickets);
}

// Enregistre un remboursement pour chaque paiement non encore remboursé de la commande.
// La contrainte UNIQUE empêche de rembourser deux fois le même paiement.
function refundPayments(order, onlyPaymentId = null) {
  let total = 0;
  const payments = all("SELECT * FROM payments WHERE order_id = ? AND kind = 'payment'", order.id);
  for (const p of payments) {
    if (onlyPaymentId && p.provider_payment_id !== onlyPaymentId) continue;
    const r = run(
      `INSERT OR IGNORE INTO payments (order_id, provider, provider_payment_id, kind, amount_cents, fee_cents, created_at)
       VALUES (?, ?, ?, 'refund', ?, 0, ?)`,
      order.id,
      p.provider,
      p.provider_payment_id,
      p.amount_cents,
      clock.nowIso(),
    );
    if (r.changes === 1) total += p.amount_cents;
  }
  return total;
}

function closeAsRefunded(order, event, reason, onlyPaymentId = null) {
  const amount = refundPayments(order, onlyPaymentId);
  if (!onlyPaymentId) {
    run(
      "UPDATE orders SET status = 'refunded', closed_at = ?, refund_reason = ? WHERE id = ?",
      clock.nowIso(),
      reason,
      order.id,
    );
  }
  if (amount > 0) mailRefund(order, event, reason, amount);
}

// Point d'entrée unique pour tout paiement reçu (notification carte ou virement confirmé).
// Idempotent : un même paiement reçu plusieurs fois ne produit qu'une commande payée.
export function recordPayment(orderId, { provider, providerPaymentId, amountCents, feeCents = 0 }) {
  return tx(() => {
    const inserted = run(
      `INSERT OR IGNORE INTO payments (order_id, provider, provider_payment_id, kind, amount_cents, fee_cents, created_at)
       VALUES (?, ?, ?, 'payment', ?, ?, ?)`,
      orderId,
      provider,
      providerPaymentId,
      amountCents,
      feeCents,
      clock.nowIso(),
    );
    if (inserted.changes === 0) return { status: 'already_recorded' };

    const order = get('SELECT * FROM orders WHERE id = ?', orderId);
    const event = getEvent(order.event_id);

    if (amountCents !== order.total_cents) {
      closeAsRefunded(order, event, 'amount_mismatch', providerPaymentId);
      return { status: 'refunded_amount_mismatch' };
    }

    if (order.status === 'pending') {
      for (const it of all('SELECT * FROM order_items WHERE order_id = ?', order.id)) {
        run('UPDATE ticket_types SET held = held - ?, sold = sold + ? WHERE id = ?', it.quantity, it.quantity, it.ticket_type_id);
      }
      issueTickets(order, event);
      return { status: 'paid' };
    }

    if (order.status === 'expired' || order.status === 'cancelled') {
      // Paiement arrivé après l'expiration (typiquement un virement en retard).
      // (H5) S'il reste des places, on valide la commande ; sinon on rembourse.
      const items = all('SELECT * FROM order_items WHERE order_id = ?', order.id);
      const needed = new Map();
      for (const it of items) needed.set(it.ticket_type_id, (needed.get(it.ticket_type_id) ?? 0) + it.quantity);
      const stillOpen = event.status === 'published' && clock.nowIso() < event.starts_at;
      const enough =
        stillOpen &&
        [...needed].every(([id, qty]) => {
          const tt = get('SELECT quota - sold - held AS available FROM ticket_types WHERE id = ?', id);
          return tt.available >= qty;
        });
      if (enough) {
        for (const [id, qty] of needed) run('UPDATE ticket_types SET sold = sold + ? WHERE id = ?', qty, id);
        issueTickets(order, event);
        return { status: 'paid_late' };
      }
      closeAsRefunded(order, event, 'late_payment_sold_out');
      return { status: 'refunded_late' };
    }

    // Commande déjà payée ou remboursée : ce second paiement est remboursé.
    closeAsRefunded(order, event, 'duplicate_payment', providerPaymentId);
    return { status: 'refunded_duplicate' };
  });
}

// ---------------------------------------------------------------------------
// Annulations
// ---------------------------------------------------------------------------

export function cancelOrderByBuyer(token) {
  return tx(() => {
    const order = get('SELECT * FROM orders WHERE token = ?', token);
    if (!order) throw notFound('Commande introuvable.');
    const event = getEvent(order.event_id);

    if (order.status === 'pending') {
      const touched = releaseStock(order);
      run("UPDATE orders SET status = 'cancelled', closed_at = ? WHERE id = ?", clock.nowIso(), order.id);
      if (order.waitlist_entry_id) run("UPDATE waitlist_entries SET status = 'declined' WHERE id = ?", order.waitlist_entry_id);
      for (const id of touched) processWaitlist(id);
      return { status: 'cancelled' };
    }

    if (order.status !== 'paid') throw conflict('not_cancellable', 'Cette commande ne peut plus être annulée.');
    if (event.status === 'cancelled') throw conflict('not_cancellable', 'L’événement est déjà annulé et remboursé.');
    if (clock.now() > cancelDeadline(event)) {
      throw conflict('cancel_deadline_passed', 'Le délai d’annulation est dépassé.');
    }
    const entered = get('SELECT COUNT(*) AS n FROM tickets WHERE order_id = ? AND entered_at IS NOT NULL', order.id);
    if (entered.n > 0) throw conflict('already_used', 'Un billet de cette commande a déjà été scanné.');

    const touched = releaseStock(order);
    run("UPDATE tickets SET status = 'cancelled' WHERE order_id = ?", order.id);
    closeAsRefunded(order, event, 'buyer_cancelled');
    // (5.5) La place libérée va d'abord à la liste d'attente, puis retourne en vente.
    for (const id of touched) processWaitlist(id);
    return { status: 'refunded' };
  });
}

// Annulation de l'événement par l'organisateur : tout le monde est remboursé.
export function cancelEvent(eventId) {
  return tx(() => {
    const event = getEvent(eventId);
    if (event.status === 'cancelled') return;
    run("UPDATE events SET status = 'cancelled' WHERE id = ?", eventId);
    const cancelled = { ...event, status: 'cancelled' };
    for (const order of all("SELECT * FROM orders WHERE event_id = ? AND status IN ('pending', 'paid')", eventId)) {
      releaseStock(order);
      if (order.status === 'pending') {
        run("UPDATE orders SET status = 'cancelled', closed_at = ? WHERE id = ?", clock.nowIso(), order.id);
      } else {
        run("UPDATE tickets SET status = 'cancelled' WHERE order_id = ?", order.id);
        closeAsRefunded(order, cancelled, 'event_cancelled');
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
