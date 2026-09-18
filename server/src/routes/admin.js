import { Router } from 'express';
import { all, get, run, tx } from '../db.js';
import { clock } from '../clock.js';
import { hashPassword, requireAuth } from '../auth.js';
import { badRequest, conflict, notFound } from '../errors.js';
import { formatDateTime, toCsv } from '../format.js';
import { cancelEvent, getEvent, processWaitlist, recordPayment, sweepExpired, ticketTypesOf } from '../services/sales.js';
import { adminEvent } from '../serialize.js';

export const adminRouter = Router();
adminRouter.use(requireAuth('admin'));

// Toute lecture passe par le collectif de l'utilisateur connecté : un événement
// d'un autre collectif répond « introuvable », comme s'il n'existait pas (4.1).
function ownEvent(req, id = req.params.id) {
  const event = get('SELECT * FROM events WHERE id = ? AND collective_id = ?', Number(id), req.user.collective_id);
  if (!event) throw notFound('Événement introuvable.');
  return event;
}

// ---------------------------------------------------------------------------
// Événements
// ---------------------------------------------------------------------------

function isValidTimeZone(tz) {
  try {
    new Intl.DateTimeFormat('fr-FR', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

const optionalInt = (v) => (v === null || v === undefined || v === '' ? null : Number(v));

function parseEventInput(body) {
  const title = String(body.title ?? '').trim();
  if (!title) throw badRequest('invalid_title', 'Le titre est obligatoire.');
  const startsAt = new Date(body.startsAt);
  if (Number.isNaN(startsAt.getTime())) throw badRequest('invalid_date', 'Date de début invalide.');
  const timezone = String(body.timezone || 'Europe/Paris');
  if (!isValidTimeZone(timezone)) throw badRequest('invalid_timezone', 'Fuseau horaire invalide.');
  const isOnline = Boolean(body.isOnline);
  const onlineUrl = isOnline ? String(body.onlineUrl ?? '').trim() : null;
  if (isOnline && !/^https?:\/\//.test(onlineUrl)) throw badRequest('invalid_url', 'Lien de l’événement en ligne invalide.');
  const venue = String(body.venue ?? '').trim();
  if (!isOnline && !venue) throw badRequest('invalid_venue', 'Indiquez le lieu.');
  const cancelDeadlineHours = Number(body.cancelDeadlineHours ?? 48);
  const maxPerOrder = Number(body.maxPerOrder ?? 6);
  if (!Number.isInteger(cancelDeadlineHours) || cancelDeadlineHours < 0) throw badRequest('invalid_deadline', 'Délai d’annulation invalide.');
  if (!Number.isInteger(maxPerOrder) || maxPerOrder < 1 || maxPerOrder > 50) throw badRequest('invalid_max', 'Maximum par commande invalide (1 à 50).');

  const ticketTypes = (Array.isArray(body.ticketTypes) ? body.ticketTypes : []).map((t, index) => {
    const name = String(t.name ?? '').trim();
    const priceCents = Number(t.priceCents);
    const quota = Number(t.quota);
    const earlyPriceCents = optionalInt(t.earlyPriceCents);
    const earlyQuota = optionalInt(t.earlyQuota);
    const earlyUntil = t.earlyUntil ? new Date(t.earlyUntil) : null;
    if (!name) throw badRequest('invalid_ticket_type', `Type de place n°${index + 1} : nom obligatoire.`);
    if (!Number.isInteger(priceCents) || priceCents < 0) throw badRequest('invalid_price', `« ${name} » : prix invalide.`);
    if (!Number.isInteger(quota) || quota < 0) throw badRequest('invalid_quota', `« ${name} » : quota invalide.`);
    if ((earlyPriceCents == null) !== (earlyUntil == null)) {
      throw badRequest('invalid_early', `« ${name} » : le tarif early demande un prix ET une date de fin.`);
    }
    if (earlyPriceCents != null && (!Number.isInteger(earlyPriceCents) || earlyPriceCents < 0 || earlyPriceCents >= priceCents)) {
      throw badRequest('invalid_early', `« ${name} » : le prix early doit être inférieur au prix normal.`);
    }
    if (earlyUntil && Number.isNaN(earlyUntil.getTime())) throw badRequest('invalid_early', `« ${name} » : date de fin early invalide.`);
    if (earlyUntil && earlyUntil > startsAt) throw badRequest('invalid_early', `« ${name} » : le tarif early doit finir avant l’événement.`);
    if (earlyQuota != null && (!Number.isInteger(earlyQuota) || earlyQuota < 0 || earlyQuota > quota)) {
      throw badRequest('invalid_early', `« ${name} » : quota early invalide.`);
    }
    return {
      id: t.id ? Number(t.id) : null,
      name,
      priceCents,
      quota,
      earlyPriceCents,
      earlyUntil: earlyUntil ? earlyUntil.toISOString() : null,
      earlyQuota: earlyPriceCents == null ? null : earlyQuota,
      position: index,
    };
  });
  if (ticketTypes.length === 0) throw badRequest('no_ticket_types', 'Ajoutez au moins un type de place.');

  return {
    title,
    description: String(body.description ?? '').trim(),
    venue,
    isOnline,
    onlineUrl,
    startsAt: startsAt.toISOString(),
    timezone,
    cancelDeadlineHours,
    maxPerOrder,
    ticketTypes,
  };
}

adminRouter.get('/events', (req, res) => {
  sweepExpired();
  const events = all('SELECT * FROM events WHERE collective_id = ? ORDER BY starts_at DESC', req.user.collective_id);
  res.json(
    events.map((e) => {
      const totals = get(
        'SELECT COALESCE(SUM(quota), 0) AS capacity, COALESCE(SUM(sold), 0) AS sold, COALESCE(SUM(held), 0) AS held FROM ticket_types WHERE event_id = ?',
        e.id,
      );
      return {
        id: e.id,
        title: e.title,
        startsAt: e.starts_at,
        timezone: e.timezone,
        status: e.status,
        isOnline: Boolean(e.is_online),
        venue: e.venue,
        ...totals,
        grossCents: moneyOf(e.id).grossCents,
      };
    }),
  );
});

adminRouter.post('/events', (req, res) => {
  const input = parseEventInput(req.body ?? {});
  const id = tx(() => {
    const { lastInsertRowid } = run(
      `INSERT INTO events (collective_id, title, description, venue, is_online, online_url, starts_at, timezone,
         cancel_deadline_hours, max_per_order, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      req.user.collective_id,
      input.title,
      input.description,
      input.venue,
      input.isOnline ? 1 : 0,
      input.onlineUrl,
      input.startsAt,
      input.timezone,
      input.cancelDeadlineHours,
      input.maxPerOrder,
      clock.nowIso(),
    );
    const eventId = Number(lastInsertRowid);
    for (const t of input.ticketTypes) insertTicketType(eventId, t);
    return eventId;
  });
  res.status(201).json(adminEvent(getEvent(id)));
});

function insertTicketType(eventId, t) {
  run(
    `INSERT INTO ticket_types (event_id, name, position, price_cents, quota, early_price_cents, early_until, early_quota)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    eventId,
    t.name,
    t.position,
    t.priceCents,
    t.quota,
    t.earlyPriceCents,
    t.earlyUntil,
    t.earlyQuota,
  );
}

adminRouter.get('/events/:id', (req, res) => {
  res.json(adminEvent(ownEvent(req)));
});

adminRouter.put('/events/:id', (req, res) => {
  const event = ownEvent(req);
  if (event.status === 'cancelled') throw conflict('event_cancelled', 'Un événement annulé ne peut plus être modifié.');
  const input = parseEventInput(req.body ?? {});
  const increased = [];
  tx(() => {
    run(
      `UPDATE events SET title = ?, description = ?, venue = ?, is_online = ?, online_url = ?, starts_at = ?,
         timezone = ?, cancel_deadline_hours = ?, max_per_order = ? WHERE id = ?`,
      input.title,
      input.description,
      input.venue,
      input.isOnline ? 1 : 0,
      input.onlineUrl,
      input.startsAt,
      input.timezone,
      input.cancelDeadlineHours,
      input.maxPerOrder,
      event.id,
    );
    const existing = new Map(ticketTypesOf(event.id).map((t) => [t.id, t]));
    const kept = new Set();
    for (const t of input.ticketTypes) {
      if (t.id == null) {
        insertTicketType(event.id, t);
        continue;
      }
      const current = existing.get(t.id);
      if (!current) throw badRequest('invalid_ticket_type', 'Type de place inconnu.');
      kept.add(t.id);
      if (t.quota < current.sold + current.held) {
        throw badRequest('quota_too_low', `« ${t.name} » : ${current.sold + current.held} places déjà vendues ou réservées, le quota ne peut pas être inférieur.`);
      }
      run(
        `UPDATE ticket_types SET name = ?, position = ?, price_cents = ?, quota = ?, early_price_cents = ?,
           early_until = ?, early_quota = ? WHERE id = ?`,
        t.name,
        t.position,
        t.priceCents,
        t.quota,
        t.earlyPriceCents,
        t.earlyUntil,
        t.earlyQuota,
        t.id,
      );
      if (t.quota > current.quota) increased.push(t.id);
    }
    for (const [id, current] of existing) {
      if (kept.has(id)) continue;
      const used = get('SELECT COUNT(*) AS n FROM order_items WHERE ticket_type_id = ?', id);
      if (used.n > 0) throw badRequest('ticket_type_used', `« ${current.name} » a déjà des commandes : il ne peut pas être supprimé.`);
      run('DELETE FROM waitlist_entries WHERE ticket_type_id = ?', id);
      run('DELETE FROM ticket_types WHERE id = ?', id);
    }
    // Des places ajoutées vont d'abord à la liste d'attente.
    for (const id of increased) processWaitlist(id);
  });
  res.json(adminEvent(getEvent(event.id)));
});

adminRouter.post('/events/:id/publish', (req, res) => {
  const event = ownEvent(req);
  if (event.status !== 'draft') throw conflict('not_draft', 'Seul un brouillon peut être publié.');
  run("UPDATE events SET status = 'published' WHERE id = ?", event.id);
  res.json(adminEvent(getEvent(event.id)));
});

adminRouter.post('/events/:id/cancel', (req, res) => {
  const event = ownEvent(req);
  cancelEvent(event.id);
  res.json(adminEvent(getEvent(event.id)));
});

// ---------------------------------------------------------------------------
// Suivi en temps réel (5.8)
// ---------------------------------------------------------------------------

function moneyOf(eventId) {
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

adminRouter.get('/events/:id/stats', (req, res) => {
  sweepExpired();
  const event = ownEvent(req);
  const types = ticketTypesOf(event.id).map((tt) => {
    const counts = get(
      `SELECT
         SUM(CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END) AS refunded,
         SUM(CASE WHEN status = 'valid' AND entered_at IS NOT NULL THEN 1 ELSE 0 END) AS entered
       FROM tickets WHERE ticket_type_id = ?`,
      tt.id,
    );
    const { gross } = get(
      `SELECT COALESCE(SUM(oi.quantity * oi.unit_price_cents), 0) AS gross
       FROM order_items oi JOIN orders o ON o.id = oi.order_id WHERE oi.ticket_type_id = ? AND o.status = 'paid'`,
      tt.id,
    );
    const { waiting } = get(
      "SELECT COUNT(*) AS waiting FROM waitlist_entries WHERE ticket_type_id = ? AND status = 'waiting'",
      tt.id,
    );
    return {
      id: tt.id,
      name: tt.name,
      quota: tt.quota,
      sold: tt.sold,
      held: tt.held,
      remaining: tt.quota - tt.sold - tt.held,
      refunded: counts.refunded ?? 0,
      entered: counts.entered ?? 0,
      waiting,
      grossCents: gross,
    };
  });
  const pending = get(
    "SELECT COUNT(*) AS orders, COALESCE(SUM(total_cents), 0) AS cents FROM orders WHERE event_id = ? AND status = 'pending'",
    event.id,
  );
  const alerts = all(
    `SELECT s.scanned_at AS scannedAt, s.gate, s.device_id AS deviceId, s.offline, t.holder_name AS holderName,
            t.code, t.entered_at AS firstEnteredAt, t.entered_gate AS firstGate
     FROM scans s JOIN tickets t ON t.id = s.ticket_id
     WHERE s.event_id = ? AND s.result = 'duplicate' ORDER BY s.id DESC LIMIT 30`,
    event.id,
  );
  res.json({
    updatedAt: clock.nowIso(),
    status: event.status,
    types,
    money: moneyOf(event.id),
    pending,
    alerts: alerts.map((a) => ({ ...a, offline: Boolean(a.offline) })),
  });
});

adminRouter.get('/events/:id/orders', (req, res) => {
  const event = ownEvent(req);
  const status = typeof req.query.status === 'string' && req.query.status ? req.query.status : null;
  const rows = all(
    `SELECT o.id, o.reference, o.buyer_name AS buyerName, o.buyer_email AS buyerEmail, o.status,
            o.payment_method AS paymentMethod, o.total_cents AS totalCents, o.created_at AS createdAt,
            o.expires_at AS expiresAt, o.refund_reason AS refundReason, o.waitlist_entry_id AS waitlistEntryId,
            (SELECT GROUP_CONCAT(oi.quantity || ' × ' || tt.name, ', ') FROM order_items oi
               JOIN ticket_types tt ON tt.id = oi.ticket_type_id WHERE oi.order_id = o.id) AS summary
     FROM orders o WHERE o.event_id = ? AND (? IS NULL OR o.status = ?) ORDER BY o.id DESC LIMIT 500`,
    event.id,
    status,
    status,
  );
  res.json(rows);
});

adminRouter.get('/events/:id/waitlist', (req, res) => {
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

// ---------------------------------------------------------------------------
// Exports (5.9)
// ---------------------------------------------------------------------------

const sendCsv = (res, filename, csv) => {
  res.set('Content-Type', 'text/csv; charset=utf-8');
  res.set('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(csv);
};

const slugify = (s) =>
  s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase();

// (H11) Colonnes demandées par les salles : nom, type de place, référence, code, entrée.
adminRouter.get('/events/:id/participants.csv', (req, res) => {
  const event = ownEvent(req);
  const rows = all(
    `SELECT t.holder_name, o.buyer_email, tt.name AS type, t.code, o.reference, t.entered_at
     FROM tickets t JOIN orders o ON o.id = t.order_id JOIN ticket_types tt ON tt.id = t.ticket_type_id
     WHERE t.event_id = ? AND t.status = 'valid' ORDER BY t.holder_name COLLATE NOCASE, t.id`,
    event.id,
  );
  const csv = toCsv(rows, [
    { label: 'Nom', value: (r) => r.holder_name },
    { label: 'E-mail', value: (r) => r.buyer_email },
    { label: 'Type de place', value: (r) => r.type },
    { label: 'Référence commande', value: (r) => r.reference },
    { label: 'Code billet', value: (r) => r.code },
    { label: 'Entré à', value: (r) => (r.entered_at ? formatDateTime(r.entered_at, event.timezone) : '') },
  ]);
  sendCsv(res, `participants-${slugify(event.title)}.csv`, csv);
});

adminRouter.get('/accounting.csv', (req, res) => {
  const rows = all(
    `SELECT p.created_at, e.title, e.timezone, o.reference, o.buyer_name, p.kind, p.provider, p.provider_payment_id,
            p.amount_cents, p.fee_cents
     FROM payments p JOIN orders o ON o.id = p.order_id JOIN events e ON e.id = o.event_id
     WHERE o.collective_id = ? ORDER BY p.created_at, p.id`,
    req.user.collective_id,
  );
  const euros = (c) => (c / 100).toFixed(2).replace('.', ',');
  const csv = toCsv(rows, [
    { label: 'Date', value: (r) => formatDateTime(r.created_at, 'Europe/Paris') },
    { label: 'Événement', value: (r) => r.title },
    { label: 'Référence', value: (r) => r.reference },
    { label: 'Client', value: (r) => r.buyer_name },
    { label: 'Opération', value: (r) => (r.kind === 'payment' ? 'Paiement' : 'Remboursement') },
    { label: 'Moyen', value: (r) => ({ mockpay: 'Carte', transfer: 'Virement', free: 'Gratuit' })[r.provider] ?? r.provider },
    { label: 'Montant (€)', value: (r) => euros(r.kind === 'payment' ? r.amount_cents : -r.amount_cents) },
    { label: 'Frais (€)', value: (r) => euros(r.fee_cents) },
    { label: 'ID prestataire', value: (r) => r.provider_payment_id },
  ]);
  sendCsv(res, 'comptabilite.csv', csv);
});

// ---------------------------------------------------------------------------
// Virements (5.2 / 5.3)
// ---------------------------------------------------------------------------

adminRouter.get('/transfers', (req, res) => {
  sweepExpired();
  const since = new Date(clock.now().getTime() - 14 * 86_400_000).toISOString();
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

adminRouter.post('/orders/:id/confirm-transfer', (req, res) => {
  const order = get(
    "SELECT * FROM orders WHERE id = ? AND collective_id = ? AND payment_method = 'transfer'",
    Number(req.params.id),
    req.user.collective_id,
  );
  if (!order) throw notFound('Commande introuvable.');
  const result = recordPayment(order.id, {
    provider: 'transfer',
    providerPaymentId: order.reference,
    amountCents: order.total_cents,
  });
  res.json(result);
});

// ---------------------------------------------------------------------------
// Équipe du collectif (3.5)
// ---------------------------------------------------------------------------

adminRouter.get('/users', (req, res) => {
  res.json(
    all(
      'SELECT id, name, email, role, created_at AS createdAt FROM users WHERE collective_id = ? ORDER BY role, name',
      req.user.collective_id,
    ),
  );
});

adminRouter.post('/users', (req, res) => {
  const name = String(req.body?.name ?? '').trim();
  const email = String(req.body?.email ?? '').trim().toLowerCase();
  const password = String(req.body?.password ?? '');
  const role = req.body?.role === 'admin' ? 'admin' : 'controller';
  if (!name) throw badRequest('invalid_name', 'Le nom est obligatoire.');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw badRequest('invalid_email', 'E-mail invalide.');
  if (password.length < 8) throw badRequest('weak_password', 'Mot de passe : 8 caractères minimum.');
  if (get('SELECT id FROM users WHERE email = ?', email)) throw conflict('email_taken', 'Cet e-mail est déjà utilisé.');
  const { lastInsertRowid } = run(
    'INSERT INTO users (collective_id, email, password_hash, name, role, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    req.user.collective_id,
    email,
    hashPassword(password),
    name,
    role,
    clock.nowIso(),
  );
  res.status(201).json(get('SELECT id, name, email, role FROM users WHERE id = ?', Number(lastInsertRowid)));
});

adminRouter.delete('/users/:id', (req, res) => {
  const id = Number(req.params.id);
  if (id === req.user.id) throw badRequest('self_delete', 'Vous ne pouvez pas supprimer votre propre compte.');
  const user = get('SELECT id FROM users WHERE id = ? AND collective_id = ?', id, req.user.collective_id);
  if (!user) throw notFound('Utilisateur introuvable.');
  run('UPDATE scans SET user_id = NULL WHERE user_id = ?', id);
  run('DELETE FROM users WHERE id = ?', id);
  res.status(204).end();
});
