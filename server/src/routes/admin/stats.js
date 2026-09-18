import { Router } from 'express';
import { all, get } from '../../db.js';
import { clock } from '../../clock.js';
import { ticketTypesOf } from '../../services/inventory.js';
import { sweepExpired } from '../../services/orders.js';
import { oneOf } from '../../validation.js';
import { ownEvent } from './ownership.js';

const ORDER_STATUSES = ['pending', 'paid', 'expired', 'cancelled', 'refunded'];
const ORDERS_PAGE_SIZE = 500;
const ALERTS_SHOWN = 30;

export function eventMoney(eventId) {
  const m = get(
    `SELECT
       COALESCE(SUM(CASE WHEN p.kind = 'payment' THEN p.amount_cents END), 0) AS received,
       COALESCE(SUM(CASE WHEN p.kind = 'refund' THEN p.amount_cents END), 0) AS refunded,
       COALESCE(SUM(p.fee_cents), 0) AS fees
     FROM payments p JOIN orders o ON o.id = p.order_id WHERE o.event_id = ?`,
    eventId,
  );
  const grossCents = m.received - m.refunded;
  return { receivedCents: m.received, refundedCents: m.refunded, grossCents, feesCents: m.fees, netCents: grossCents - m.fees };
}

function ticketTypeStats(tt) {
  const counts = get(
    `SELECT
       COALESCE(SUM(CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END), 0) AS refunded,
       COALESCE(SUM(CASE WHEN status = 'valid' AND entered_at IS NOT NULL THEN 1 ELSE 0 END), 0) AS entered
     FROM tickets WHERE ticket_type_id = ?`,
    tt.id,
  );
  const { gross } = get(
    `SELECT COALESCE(SUM(oi.quantity * oi.unit_price_cents), 0) AS gross
     FROM order_items oi JOIN orders o ON o.id = oi.order_id WHERE oi.ticket_type_id = ? AND o.status = 'paid'`,
    tt.id,
  );
  const { waiting } = get("SELECT COUNT(*) AS waiting FROM waitlist_entries WHERE ticket_type_id = ? AND status = 'waiting'", tt.id);
  return {
    id: tt.id,
    name: tt.name,
    quota: tt.quota,
    sold: tt.sold,
    held: tt.held,
    remaining: tt.quota - tt.sold - tt.held,
    refunded: counts.refunded,
    entered: counts.entered,
    waiting,
    grossCents: gross,
  };
}

// Suivi en temps réel (5.8) : vendues, réservées, remboursées, restantes, encaissé, entrées.
export const statsRouter = Router();

statsRouter.get('/:id/stats', (req, res) => {
  sweepExpired();
  const event = ownEvent(req);
  const pending = get(
    "SELECT COUNT(*) AS orders, COALESCE(SUM(total_cents), 0) AS cents FROM orders WHERE event_id = ? AND status = 'pending'",
    event.id,
  );
  const alerts = all(
    `SELECT s.id, s.scanned_at AS scannedAt, s.gate, s.device_id AS deviceId, s.offline, t.holder_name AS holderName,
            t.code, t.entered_at AS firstEnteredAt, t.entered_gate AS firstGate
     FROM scans s JOIN tickets t ON t.id = s.ticket_id
     WHERE s.event_id = ? AND s.result = 'duplicate' ORDER BY s.id DESC LIMIT ?`,
    event.id,
    ALERTS_SHOWN,
  );
  res.json({
    updatedAt: clock.nowIso(),
    status: event.status,
    types: ticketTypesOf(event.id).map(ticketTypeStats),
    money: eventMoney(event.id),
    pending,
    alerts: alerts.map((a) => ({ ...a, offline: Boolean(a.offline) })),
  });
});

statsRouter.get('/:id/orders', (req, res) => {
  const event = ownEvent(req);
  const status = req.query.status ? oneOf(req.query.status, ORDER_STATUSES, 'Statut') : null;
  res.json(
    all(
      `SELECT o.id, o.reference, o.buyer_name AS buyerName, o.buyer_email AS buyerEmail, o.status,
              o.payment_method AS paymentMethod, o.total_cents AS totalCents, o.created_at AS createdAt,
              o.expires_at AS expiresAt, o.refund_reason AS refundReason, o.waitlist_entry_id AS waitlistEntryId,
              (SELECT GROUP_CONCAT(oi.quantity || ' × ' || tt.name, ', ') FROM order_items oi
                 JOIN ticket_types tt ON tt.id = oi.ticket_type_id WHERE oi.order_id = o.id) AS summary
       FROM orders o WHERE o.event_id = ? AND (? IS NULL OR o.status = ?) ORDER BY o.id DESC LIMIT ?`,
      event.id,
      status,
      status,
      ORDERS_PAGE_SIZE,
    ),
  );
});

statsRouter.get('/:id/waitlist', (req, res) => {
  const event = ownEvent(req);
  res.json(
    all(
      `SELECT w.id, w.name, w.email, w.quantity, w.status, w.created_at AS createdAt, w.offered_at AS offeredAt,
              tt.name AS ticketTypeName, o.expires_at AS offerExpiresAt
       FROM waitlist_entries w JOIN ticket_types tt ON tt.id = w.ticket_type_id
       LEFT JOIN orders o ON o.id = w.offer_order_id
       WHERE w.event_id = ? ORDER BY w.id`,
      event.id,
    ),
  );
});
