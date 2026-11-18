import { all, get, run, tx } from '../db.js';
import { clock } from '../clock.js';
import { confirmHeldSeats, getEvent, orderItemsOf, retakeSeats, salesOpen } from './inventory.js';
import { issueOrderAccessToken } from '../orderAccess.js';
import { mailRefund, mailTickets } from './mailer.js';
import { newTicketCode } from './tickets.js';

// Émet les billets d'une commande et la passe au statut payé. À appeler dans une transaction.
export function issueTickets(order, event) {
  const now = clock.nowIso();
  run("UPDATE orders SET status = 'paid', paid_at = ? WHERE id = ?", now, order.id);
  for (const item of orderItemsOf(order.id)) {
    for (let i = 0; i < item.quantity; i++) {
      run(
        `INSERT INTO tickets (code, order_id, event_id, ticket_type_id, holder_name, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        newTicketCode(),
        order.id,
        event.id,
        item.ticket_type_id,
        order.buyer_name,
        now,
      );
    }
  }
  if (order.waitlist_entry_id) {
    run("UPDATE waitlist_entries SET status = 'converted' WHERE id = ?", order.waitlist_entry_id);
  }
  const tickets = all(
    `SELECT t.code, tt.name AS ticket_type_name FROM tickets t
     JOIN ticket_types tt ON tt.id = t.ticket_type_id WHERE t.order_id = ? ORDER BY t.id`,
    order.id,
  );
  const paidOrder = get('SELECT * FROM orders WHERE id = ?', order.id);
  mailTickets({ ...paidOrder, accessToken: issueOrderAccessToken(paidOrder, event) }, event, tickets);
}

// Enregistre un remboursement pour chaque paiement non encore remboursé de la commande.
// La contrainte UNIQUE empêche de rembourser deux fois le même paiement.
function refundPayments(order, onlyPaymentId = null) {
  let total = 0;
  for (const p of all("SELECT * FROM payments WHERE order_id = ? AND kind = 'payment'", order.id)) {
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

// Rembourse la commande entière (et la clôt), ou un seul paiement en trop.
export function refund(order, event, reason, onlyPaymentId = null) {
  const amount = refundPayments(order, onlyPaymentId);
  if (!onlyPaymentId) {
    run("UPDATE orders SET status = 'refunded', closed_at = ?, refund_reason = ? WHERE id = ?", clock.nowIso(), reason, order.id);
  }
  if (amount > 0) mailRefund(order, event, reason, amount);
}

// Point d'entrée unique pour tout paiement reçu (notification carte ou virement confirmé).
// Idempotent : un même paiement reçu plusieurs fois ne produit qu'une commande payée.
// Le montant attendu est celui calculé par le serveur à la création de la commande.
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
      refund(order, event, 'amount_mismatch', providerPaymentId);
      return { status: 'refunded_amount_mismatch' };
    }

    if (order.status === 'pending') {
      confirmHeldSeats(order.id);
      issueTickets(order, event);
      return { status: 'paid' };
    }

    if (order.status === 'expired' || order.status === 'cancelled') {
      // (H5) Paiement arrivé après l'expiration : validé s'il reste des places, sinon remboursé.
      if (salesOpen(event) && retakeSeats(order.id)) {
        issueTickets(order, event);
        return { status: 'paid_late' };
      }
      refund(order, event, 'late_payment_sold_out');
      return { status: 'refunded_late' };
    }

    // Commande déjà payée ou remboursée : ce second paiement est remboursé.
    refund(order, event, 'duplicate_payment', providerPaymentId);
    return { status: 'refunded_duplicate' };
  });
}
