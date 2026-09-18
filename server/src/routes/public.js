import crypto from 'node:crypto';
import { Router } from 'express';
import { all, get, run } from '../db.js';
import { clock } from '../clock.js';
import { notFound } from '../errors.js';
import {
  assertOrderPayable,
  cancelOrderByBuyer,
  createOrder,
  getEvent,
  joinWaitlist,
  sweepExpired,
  ticketTypesOf,
} from '../services/sales.js';
import { eventSummary, publicEvent, publicOrder, publicTicketType } from '../serialize.js';

export const publicRouter = Router();

publicRouter.get('/collectives', (_req, res) => {
  res.json(all('SELECT id, name, slug, color FROM collectives ORDER BY name'));
});

// Vitrine commune (4.3) : tous les événements publiés, filtrables par collectif.
publicRouter.get('/events', (req, res) => {
  sweepExpired();
  const since = new Date(clock.now().getTime() - 6 * 3_600_000).toISOString();
  const slug = typeof req.query.collective === 'string' ? req.query.collective : null;
  const rows = slug
    ? all(
        `SELECT e.* FROM events e JOIN collectives c ON c.id = e.collective_id
         WHERE e.status = 'published' AND e.starts_at > ? AND c.slug = ? ORDER BY e.starts_at`,
        since,
        slug,
      )
    : all("SELECT * FROM events WHERE status = 'published' AND starts_at > ? ORDER BY starts_at", since);
  res.json(rows.map(eventSummary));
});

publicRouter.get('/events/:id', (req, res) => {
  sweepExpired();
  const event = getEvent(Number(req.params.id));
  if (!event || event.status === 'draft') throw notFound('Événement introuvable.');
  res.json({
    ...publicEvent(event),
    salesOpen: event.status === 'published' && clock.nowIso() < event.starts_at,
    ticketTypes: ticketTypesOf(event.id).map(publicTicketType),
  });
});

publicRouter.post('/events/:id/orders', (req, res) => {
  const order = createOrder(Number(req.params.id), req.body ?? {});
  res.status(201).json({ token: order.token, status: order.status });
});

publicRouter.post('/events/:id/waitlist', (req, res) => {
  res.status(201).json(joinWaitlist(Number(req.params.id), req.body ?? {}));
});

const orderByToken = (token) => {
  const order = get('SELECT * FROM orders WHERE token = ?', String(token));
  if (!order) throw notFound('Commande introuvable.');
  return order;
};

publicRouter.get('/orders/:token', (req, res) => {
  sweepExpired();
  res.json(publicOrder(orderByToken(req.params.token)));
});

// Ouvre une session chez le prestataire de paiement (simulé ici) et renvoie l'URL de paiement.
publicRouter.post('/orders/:token/checkout', (req, res) => {
  sweepExpired();
  const order = orderByToken(req.params.token);
  assertOrderPayable(order);
  const event = getEvent(order.event_id);
  const id = `cs_${crypto.randomBytes(12).toString('hex')}`;
  run(
    'INSERT INTO mock_provider_sessions (id, order_token, amount_cents, label, created_at) VALUES (?, ?, ?, ?, ?)',
    id,
    order.token,
    order.total_cents,
    `${event.title} — ${order.reference}`,
    clock.nowIso(),
  );
  res.json({ redirectUrl: `/paiement-simule/${id}` });
});

publicRouter.post('/orders/:token/cancel', (req, res) => {
  const order = orderByToken(req.params.token);
  cancelOrderByBuyer(order.token);
  res.json(publicOrder(orderByToken(order.token)));
});
