import crypto from 'node:crypto';
import { Router } from 'express';
import { all, get, run } from '../db.js';
import { clock } from '../clock.js';
import { config } from '../config.js';
import { notFound, unavailable } from '../errors.js';
import { getEvent, salesOpen, ticketTypesOf } from '../services/inventory.js';
import { assertOrderPayable, cancelOrderByBuyer, createOrder, sweepExpired } from '../services/orders.js';
import { joinWaitlist } from '../services/waitlist.js';
import { eventSummary, publicEvent, publicOrder, publicTicketType } from '../serialize.js';
import { idempotencyKey, isSlug, routeId, routeToken } from '../validation.js';

const RECENT_EVENTS_HOURS = 6;

// Pages publiques : aucune authentification. Une commande n'est accessible qu'avec son jeton
// secret (144 bits aléatoires) reçu par mail : les identifiants ne sont pas devinables (pas d'IDOR).
export function publicRouter(limits) {
  const router = Router();

  router.get('/collectives', (_req, res) => {
    res.json(all('SELECT id, name, slug, color FROM collectives ORDER BY name'));
  });

  // Vitrine commune (4.3) : tous les événements publiés, filtrables par collectif.
  router.get('/events', (req, res) => {
    sweepExpired();
    const since = new Date(clock.now().getTime() - RECENT_EVENTS_HOURS * 3_600_000).toISOString();
    const slug = req.query.collective;
    if (slug !== undefined && !isSlug(slug)) return res.json([]);
    const rows = slug
      ? all(
          `SELECT e.* FROM events e JOIN collectives c ON c.id = e.collective_id
           WHERE e.status = 'published' AND e.starts_at > ? AND c.slug = ? ORDER BY e.starts_at`,
          since,
          slug,
        )
      : all("SELECT * FROM events WHERE status = 'published' AND starts_at > ? ORDER BY starts_at", since);
    return res.json(rows.map(eventSummary));
  });

  router.get('/events/:id', (req, res) => {
    sweepExpired();
    const event = getEvent(routeId(req.params.id));
    if (!event || event.status === 'draft') throw notFound('Événement introuvable.');
    res.json({
      ...publicEvent(event),
      salesOpen: salesOpen(event),
      ticketTypes: ticketTypesOf(event.id).map(publicTicketType),
    });
  });

  router.post('/events/:id/orders', limits.orders, (req, res) => {
    const { order, replayed } = createOrder(routeId(req.params.id), req.body ?? {}, idempotencyKey(req.get('idempotency-key')));
    res.status(replayed ? 200 : 201).json({ token: order.token, status: order.status });
  });

  router.post('/events/:id/waitlist', limits.waitlist, (req, res) => {
    res.status(201).json(joinWaitlist(routeId(req.params.id), req.body ?? {}));
  });

  const orderByToken = (token) => {
    const order = get('SELECT * FROM orders WHERE token = ?', routeToken(token));
    if (!order) throw notFound('Commande introuvable.');
    return order;
  };

  router.get('/orders/:token', (req, res) => {
    sweepExpired();
    res.json(publicOrder(orderByToken(req.params.token)));
  });

  // Ouvre une session chez le prestataire de paiement et renvoie l'URL de paiement.
  router.post('/orders/:token/checkout', limits.checkout, (req, res) => {
    if (config.paymentProvider !== 'mock') {
      throw unavailable('payment_unavailable', 'Le paiement par carte est momentanément indisponible.');
    }
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

  router.post('/orders/:token/cancel', limits.orders, (req, res) => {
    const order = orderByToken(req.params.token);
    cancelOrderByBuyer(order.token);
    res.json(publicOrder(orderByToken(order.token)));
  });

  return router;
}
