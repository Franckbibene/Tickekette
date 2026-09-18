import { all, get, run } from '../db.js';
import { clock } from '../clock.js';
import { config } from '../config.js';
import { conflict } from '../errors.js';

// Stock des places et règles de prix. Le prix est toujours calculé ici, côté serveur :
// aucun montant envoyé par le navigateur n'est jamais utilisé.

const HOUR_MS = 3_600_000;

export const getEvent = (id) => get('SELECT * FROM events WHERE id = ?', id);

export const ticketTypesOf = (eventId) => all('SELECT * FROM ticket_types WHERE event_id = ? ORDER BY position, id', eventId);

export const orderItemsOf = (orderId) =>
  all(
    `SELECT oi.*, tt.name AS ticket_type_name FROM order_items oi
     JOIN ticket_types tt ON tt.id = oi.ticket_type_id WHERE oi.order_id = ? ORDER BY oi.id`,
    orderId,
  );

export const availableSeats = (tt) => Math.max(0, tt.quota - tt.sold - tt.held);

export const salesOpen = (event, now = clock.now()) => event.status === 'published' && now.toISOString() < event.starts_at;

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
    available: availableSeats(tt),
  };
}

// (H4) Le virement n'est proposé que jusqu'à 72 h avant l'événement.
export const transferAllowed = (event, now = clock.now()) =>
  now.getTime() <= Date.parse(event.starts_at) - config.transferClosesHoursBefore * HOUR_MS;

// (H9) Annulation possible jusqu'à N heures avant, N réglable par événement.
export const cancelDeadline = (event) => new Date(Date.parse(event.starts_at) - event.cancel_deadline_hours * HOUR_MS);

// Réserve atomiquement les places et calcule les lignes de prix. À appeler dans une transaction.
// La mise à jour conditionnelle ne réussit que s'il reste assez de places : si deux personnes
// visent la dernière place au même moment, une seule mise à jour aboutit.
export function holdSeats(event, items, now = clock.now()) {
  const lines = [];
  for (const { ticketTypeId, quantity } of items) {
    const held = run(
      'UPDATE ticket_types SET held = held + ? WHERE id = ? AND event_id = ? AND sold + held + ? <= quota',
      quantity,
      ticketTypeId,
      event.id,
      quantity,
    );
    const tt = get('SELECT * FROM ticket_types WHERE id = ?', ticketTypeId);
    if (held.changes !== 1) {
      const available = availableSeats(tt);
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
    if (early > 0) lines.push({ ticketTypeId, quantity: early, unitPriceCents: tt.early_price_cents, isEarly: 1 });
    if (quantity > early) {
      lines.push({ ticketTypeId, quantity: quantity - early, unitPriceCents: tt.price_cents, isEarly: 0 });
    }
  }
  return lines;
}

// Rend au stock les places d'une commande. Retourne les types de place concernés.
export function releaseSeats(order) {
  const touched = new Set();
  for (const item of all('SELECT * FROM order_items WHERE order_id = ?', order.id)) {
    if (order.status === 'pending') {
      run('UPDATE ticket_types SET held = held - ? WHERE id = ?', item.quantity, item.ticket_type_id);
      // (H1) Une réservation early jamais payée rend sa place early.
      if (item.is_early) {
        run('UPDATE ticket_types SET early_used = MAX(0, early_used - ?) WHERE id = ?', item.quantity, item.ticket_type_id);
      }
    } else if (order.status === 'paid') {
      // (H1) Une place early payée puis annulée revient au tarif normal.
      run('UPDATE ticket_types SET sold = sold - ? WHERE id = ?', item.quantity, item.ticket_type_id);
    }
    touched.add(item.ticket_type_id);
  }
  return touched;
}

// Transforme les places réservées d'une commande en places vendues.
export function confirmHeldSeats(orderId) {
  for (const item of all('SELECT * FROM order_items WHERE order_id = ?', orderId)) {
    run('UPDATE ticket_types SET held = held - ?, sold = sold + ? WHERE id = ?', item.quantity, item.quantity, item.ticket_type_id);
  }
}

// Paiement arrivé après l'expiration : reprend les places si elles sont encore libres.
// Retourne false (sans rien modifier) s'il n'y en a plus assez.
export function retakeSeats(orderId) {
  const needed = new Map();
  for (const item of all('SELECT * FROM order_items WHERE order_id = ?', orderId)) {
    needed.set(item.ticket_type_id, (needed.get(item.ticket_type_id) ?? 0) + item.quantity);
  }
  const enough = [...needed].every(([id, qty]) => availableSeats(get('SELECT * FROM ticket_types WHERE id = ?', id)) >= qty);
  if (!enough) return false;
  for (const [id, qty] of needed) run('UPDATE ticket_types SET sold = sold + ? WHERE id = ?', qty, id);
  return true;
}
