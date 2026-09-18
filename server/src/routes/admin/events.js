import { Router } from 'express';
import { all, get, run, tx } from '../../db.js';
import { clock } from '../../clock.js';
import { badRequest, conflict } from '../../errors.js';
import { getEvent, ticketTypesOf } from '../../services/inventory.js';
import { cancelEvent, sweepExpired } from '../../services/orders.js';
import { processWaitlist } from '../../services/waitlist.js';
import { adminEvent } from '../../serialize.js';
import { LIMITS, httpUrl, integer, isValidTimeZone, isoDate, optionalInteger, text } from '../../validation.js';
import { eventMoney } from './stats.js';
import { ownEvent } from './ownership.js';

const DEFAULT_TIMEZONE = 'Europe/Paris';

function parseTicketType(raw, index, startsAt) {
  const label = `Type de place n°${index + 1}`;
  const name = text(raw?.name, { field: `${label} (nom)`, max: LIMITS.name });
  const priceCents = integer(raw?.priceCents, { field: `« ${name} » : prix`, min: 0, max: LIMITS.priceCentsMax });
  const quota = integer(raw?.quota, { field: `« ${name} » : quota`, min: 0, max: LIMITS.quotaMax });
  const earlyPriceCents = optionalInteger(raw?.earlyPriceCents, { field: `« ${name} » : prix early`, min: 0, max: priceCents });
  const earlyUntil = raw?.earlyUntil ? isoDate(raw.earlyUntil, `« ${name} » : fin du tarif early`) : null;
  if ((earlyPriceCents === null) !== (earlyUntil === null)) {
    throw badRequest('invalid_early', `« ${name} » : le tarif early demande un prix ET une date de fin.`);
  }
  if (earlyPriceCents !== null && earlyPriceCents >= priceCents) {
    throw badRequest('invalid_early', `« ${name} » : le prix early doit être inférieur au prix normal.`);
  }
  if (earlyUntil && earlyUntil > startsAt) throw badRequest('invalid_early', `« ${name} » : le tarif early doit finir avant l’événement.`);
  const earlyQuota =
    earlyPriceCents === null ? null : optionalInteger(raw?.earlyQuota, { field: `« ${name} » : quota early`, min: 0, max: quota });
  const id =
    raw?.id === null || raw?.id === undefined ? null : integer(raw.id, { field: 'Identifiant', min: 1, max: Number.MAX_SAFE_INTEGER });
  return { id, name, priceCents, quota, earlyPriceCents, earlyUntil: earlyUntil?.toISOString() ?? null, earlyQuota, position: index };
}

function parseEventInput(body, { requireFuture }) {
  const title = text(body.title, { field: 'Titre', max: LIMITS.title });
  const startsAt = isoDate(body.startsAt, 'Date de début');
  if (requireFuture && startsAt <= clock.now()) throw badRequest('invalid_date', 'La date de début doit être dans le futur.');
  const timezone = body.timezone ?? DEFAULT_TIMEZONE;
  if (!isValidTimeZone(timezone)) throw badRequest('invalid_timezone', 'Fuseau horaire invalide.');
  // Booléen strict : la chaîne "false" ne doit pas être comprise comme vraie.
  const isOnline = body.isOnline === true;
  const onlineUrl = isOnline ? httpUrl(body.onlineUrl, 'Lien de l’événement en ligne') : null;
  const venue = text(body.venue, { field: 'Lieu', max: LIMITS.venue, required: !isOnline });
  const rawTypes = Array.isArray(body.ticketTypes) ? body.ticketTypes : [];
  if (rawTypes.length === 0) throw badRequest('no_ticket_types', 'Ajoutez au moins un type de place.');
  if (rawTypes.length > LIMITS.ticketTypesMax) throw badRequest('too_many_types', `${LIMITS.ticketTypesMax} types de place maximum.`);
  return {
    title,
    description: text(body.description, { field: 'Description', max: LIMITS.description, required: false }),
    venue,
    isOnline,
    onlineUrl,
    startsAt: startsAt.toISOString(),
    timezone,
    cancelDeadlineHours: integer(body.cancelDeadlineHours ?? 48, {
      field: 'Délai d’annulation',
      min: 0,
      max: LIMITS.cancelDeadlineHoursMax,
    }),
    maxPerOrder: integer(body.maxPerOrder ?? 6, { field: 'Places par commande', min: 1, max: LIMITS.maxPerOrderMax }),
    ticketTypes: rawTypes.map((t, i) => parseTicketType(t, i, startsAt)),
  };
}

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

// Met à jour les types de place existants, ajoute les nouveaux, supprime ceux qui n'ont aucune commande.
// Retourne les types dont le quota a augmenté (les places ajoutées vont d'abord à la liste d'attente).
function syncTicketTypes(eventId, inputTypes) {
  const existing = new Map(ticketTypesOf(eventId).map((t) => [t.id, t]));
  const kept = new Set();
  const increased = [];
  for (const t of inputTypes) {
    if (t.id === null) {
      insertTicketType(eventId, t);
      continue;
    }
    const current = existing.get(t.id);
    if (!current) throw badRequest('invalid_ticket_type', 'Type de place inconnu.');
    kept.add(t.id);
    if (t.quota < current.sold + current.held) {
      throw badRequest(
        'quota_too_low',
        `« ${t.name} » : ${current.sold + current.held} places déjà vendues ou réservées, le quota ne peut pas être inférieur.`,
      );
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
  return increased;
}

export const eventsRouter = Router();

eventsRouter.get('/', (req, res) => {
  sweepExpired();
  const events = all('SELECT * FROM events WHERE collective_id = ? ORDER BY starts_at DESC', req.user.collective_id);
  res.json(
    events.map((e) => {
      const totals = get(
        `SELECT COALESCE(SUM(quota), 0) AS capacity, COALESCE(SUM(sold), 0) AS sold, COALESCE(SUM(held), 0) AS held
         FROM ticket_types WHERE event_id = ?`,
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
        grossCents: eventMoney(e.id).grossCents,
      };
    }),
  );
});

eventsRouter.post('/', (req, res) => {
  const input = parseEventInput(req.body ?? {}, { requireFuture: true });
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
    for (const t of input.ticketTypes) {
      if (t.id !== null) throw badRequest('invalid_ticket_type', 'Type de place inconnu.');
      insertTicketType(eventId, t);
    }
    return eventId;
  });
  res.status(201).json(adminEvent(getEvent(id)));
});

eventsRouter.get('/:id', (req, res) => {
  res.json(adminEvent(ownEvent(req)));
});

eventsRouter.put('/:id', (req, res) => {
  const event = ownEvent(req);
  if (event.status === 'cancelled') throw conflict('event_cancelled', 'Un événement annulé ne peut plus être modifié.');
  const input = parseEventInput(req.body ?? {}, { requireFuture: false });
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
    for (const id of syncTicketTypes(event.id, input.ticketTypes)) processWaitlist(id);
  });
  res.json(adminEvent(getEvent(event.id)));
});

eventsRouter.post('/:id/publish', (req, res) => {
  const event = ownEvent(req);
  // Mise à jour conditionnelle : deux clics simultanés ne publient pas deux fois.
  const published = run("UPDATE events SET status = 'published' WHERE id = ? AND status = 'draft'", event.id);
  if (published.changes !== 1) throw conflict('not_draft', 'Seul un brouillon peut être publié.');
  res.json(adminEvent(getEvent(event.id)));
});

eventsRouter.post('/:id/cancel', (req, res) => {
  const event = ownEvent(req);
  cancelEvent(event.id);
  res.json(adminEvent(getEvent(event.id)));
});
