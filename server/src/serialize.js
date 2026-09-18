import { all, get } from './db.js';
import { clock } from './clock.js';
import { cancelDeadline, orderItemsOf, pricing, ticketTypesOf, transferAllowed } from './services/sales.js';
import { qrPayload } from './services/tickets.js';

export function publicEvent(event) {
  const collective = get('SELECT name, slug, color FROM collectives WHERE id = ?', event.collective_id);
  return {
    id: event.id,
    title: event.title,
    description: event.description,
    venue: event.venue,
    isOnline: Boolean(event.is_online),
    startsAt: event.starts_at,
    timezone: event.timezone,
    status: event.status,
    maxPerOrder: event.max_per_order,
    cancelDeadlineHours: event.cancel_deadline_hours,
    transferAllowed: transferAllowed(event),
    collective,
  };
}

export function publicTicketType(tt) {
  const p = pricing(tt);
  const { waiting } = get(
    "SELECT COUNT(*) AS waiting FROM waitlist_entries WHERE ticket_type_id = ? AND status = 'waiting'",
    tt.id,
  );
  return {
    id: tt.id,
    name: tt.name,
    priceCents: p.priceCents,
    earlyActive: p.earlyActive,
    earlyPriceCents: p.earlyPriceCents,
    earlyUntil: p.earlyActive ? tt.early_until : null,
    earlyRemaining: p.earlyRemaining,
    available: p.available,
    waitlistCount: waiting,
  };
}

export function eventSummary(event) {
  const types = ticketTypesOf(event.id).map(publicTicketType);
  const prices = types.filter((t) => t.available > 0).map((t) => t.earlyPriceCents ?? t.priceCents);
  return {
    ...publicEvent(event),
    fromPriceCents: prices.length ? Math.min(...prices) : null,
    soldOut: types.every((t) => t.available === 0),
  };
}

export function publicOrder(order) {
  const event = get('SELECT * FROM events WHERE id = ?', order.event_id);
  const collective = get('SELECT iban FROM collectives WHERE id = ?', event.collective_id);
  const isPaid = order.status === 'paid';
  const tickets = isPaid
    ? all(
        `SELECT t.code, t.holder_name, t.status, t.entered_at, tt.name AS ticket_type_name
         FROM tickets t JOIN ticket_types tt ON tt.id = t.ticket_type_id WHERE t.order_id = ? ORDER BY t.id`,
        order.id,
      ).map((t) => ({
        code: t.code,
        qr: qrPayload(t.code),
        holderName: t.holder_name,
        ticketTypeName: t.ticket_type_name,
        status: t.status,
        enteredAt: t.entered_at,
      }))
    : [];
  const deadline = cancelDeadline(event);
  const canCancel =
    order.status === 'pending' ||
    (isPaid && event.status !== 'cancelled' && clock.now() <= deadline && tickets.every((t) => !t.enteredAt));
  return {
    token: order.token,
    reference: order.reference,
    status: order.status,
    buyerName: order.buyer_name,
    buyerEmail: order.buyer_email,
    paymentMethod: order.payment_method,
    totalCents: order.total_cents,
    expiresAt: order.expires_at,
    paidAt: order.paid_at,
    refundReason: order.refund_reason,
    isWaitlistOffer: Boolean(order.waitlist_entry_id),
    items: orderItemsOf(order.id).map((i) => ({
      ticketTypeName: i.ticket_type_name,
      quantity: i.quantity,
      unitPriceCents: i.unit_price_cents,
      isEarly: Boolean(i.is_early),
    })),
    event: { ...publicEvent(event), onlineUrl: isPaid && event.is_online ? event.online_url : null },
    tickets,
    bank:
      order.payment_method === 'transfer' && order.status === 'pending'
        ? { iban: collective.iban, reference: order.reference }
        : null,
    canCancel,
    cancelDeadline: deadline.toISOString(),
    serverNow: clock.nowIso(),
  };
}

export function adminEvent(event) {
  return {
    ...publicEvent(event),
    onlineUrl: event.online_url,
    ticketTypes: ticketTypesOf(event.id).map((tt) => ({
      id: tt.id,
      name: tt.name,
      priceCents: tt.price_cents,
      quota: tt.quota,
      earlyPriceCents: tt.early_price_cents,
      earlyUntil: tt.early_until,
      earlyQuota: tt.early_quota,
      sold: tt.sold,
      held: tt.held,
      earlyUsed: tt.early_used,
    })),
  };
}
