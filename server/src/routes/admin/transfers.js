import { Router } from 'express';
import { all, get } from '../../db.js';
import { clock } from '../../clock.js';
import { notFound } from '../../errors.js';
import { sweepExpired } from '../../services/orders.js';
import { recordPayment } from '../../services/payments.js';
import { routeId } from '../../validation.js';

const LATE_TRANSFER_WINDOW_DAYS = 14;

// Rapprochement des virements (5.2 / 5.3). Seules les commandes du collectif connecté sont visibles.
export const transfersRouter = Router();

transfersRouter.get('/transfers', (req, res) => {
  sweepExpired();
  const since = new Date(clock.now().getTime() - LATE_TRANSFER_WINDOW_DAYS * 86_400_000).toISOString();
  res.json(
    all(
      `SELECT o.id, o.reference, o.buyer_name AS buyerName, o.buyer_email AS buyerEmail, o.total_cents AS totalCents,
              o.status, o.expires_at AS expiresAt, o.created_at AS createdAt, e.title AS eventTitle, e.timezone
       FROM orders o JOIN events e ON e.id = o.event_id
       WHERE o.collective_id = ? AND o.payment_method = 'transfer'
         AND (o.status = 'pending' OR (o.status = 'expired' AND o.closed_at >= ?))
       ORDER BY o.status = 'pending' DESC, o.expires_at`,
      req.user.collective_id,
      since,
    ),
  );
});

// Le montant enregistré est celui de la commande (calculé par le serveur), jamais un montant saisi.
transfersRouter.post('/orders/:id/confirm-transfer', (req, res) => {
  const order = get(
    "SELECT * FROM orders WHERE id = ? AND collective_id = ? AND payment_method = 'transfer'",
    routeId(req.params.id),
    req.user.collective_id,
  );
  if (!order) throw notFound('Commande introuvable.');
  res.json(recordPayment(order.id, { provider: 'transfer', providerPaymentId: order.reference, amountCents: order.total_cents }));
});
