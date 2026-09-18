import { get, run, tx } from '../db.js';
import { clock } from '../clock.js';
import { config } from '../config.js';
import { badRequest, conflict, notFound } from '../errors.js';
import { LIMITS, email, integer, text } from '../validation.js';
import { availableSeats, getEvent, salesOpen } from './inventory.js';
import { mailWaitlistJoined, mailWaitlistOffer } from './mailer.js';
import { createOrderInTx, sweepExpired } from './orders.js';

// Propose les places libres aux personnes en attente, dans l'ordre d'inscription.
// Les places sont réservées pour la personne avant d'être visibles du public :
// une place libérée ne repart en vente que si la liste d'attente est vide.
// (H6) Si la première personne veut plus de places qu'il n'en reste, on lui propose ce qui reste.
export function processWaitlist(ticketTypeId) {
  tx(() => {
    const tt = get('SELECT * FROM ticket_types WHERE id = ?', ticketTypeId);
    const event = getEvent(tt.event_id);
    if (!salesOpen(event)) return;
    let available = availableSeats(tt);
    while (available > 0) {
      const entry = get("SELECT * FROM waitlist_entries WHERE ticket_type_id = ? AND status = 'waiting' ORDER BY id LIMIT 1", ticketTypeId);
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
  const name = text(input.name, { field: 'Nom', max: LIMITS.name });
  const address = email(input.email);
  return tx(() => {
    sweepExpired();
    const event = getEvent(eventId);
    if (!event || event.status !== 'published') throw notFound('Événement introuvable.');
    if (!salesOpen(event)) throw conflict('sales_closed', 'L’événement a commencé.');
    const quantity = integer(input.quantity ?? 1, { field: 'Nombre de places', min: 1, max: event.max_per_order });
    const tt = get('SELECT * FROM ticket_types WHERE id = ? AND event_id = ?', Number(input.ticketTypeId), eventId);
    if (!tt) throw badRequest('invalid_ticket_type', 'Type de place invalide.');
    if (availableSeats(tt) > 0) {
      throw conflict('seats_available', 'Il reste des places : vous pouvez les acheter directement.');
    }
    const existing = get(
      "SELECT id FROM waitlist_entries WHERE ticket_type_id = ? AND email = ? AND status IN ('waiting', 'offered')",
      tt.id,
      address,
    );
    if (existing) throw conflict('already_registered', 'Cette adresse est déjà sur la liste d’attente.');
    const { lastInsertRowid } = run(
      `INSERT INTO waitlist_entries (event_id, ticket_type_id, name, email, quantity, locale, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      eventId,
      tt.id,
      name,
      address,
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
