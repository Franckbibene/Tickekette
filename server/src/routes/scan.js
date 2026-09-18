import crypto from 'node:crypto';
import { Router } from 'express';
import { all, get } from '../db.js';
import { clock } from '../clock.js';
import { requireAuth } from '../auth.js';
import { badRequest, notFound } from '../errors.js';
import { ticketTypesOf } from '../services/inventory.js';
import { entriesOf, manifest, recordScan } from '../services/scans.js';
import { routeId } from '../validation.js';

const MAX_SCANS_PER_SYNC = 2000;
const SCAN_TEXT_MAX = 200;
const LABEL_MAX = 64;
const RECENT_EVENTS_HOURS = 24;
const EVENTS_SHOWN = 20;

// Contrôle à l'entrée (5.7). Accessible aux contrôleurs et aux admins du collectif.
// Les contrôleurs n'ont accès à aucun chiffre de vente.
export const scanRouter = Router();
scanRouter.use(requireAuth('admin', 'controller'));

function ownPublishedEvent(req) {
  const event = get(
    "SELECT * FROM events WHERE id = ? AND collective_id = ? AND status = 'published'",
    routeId(req.params.id),
    req.user.collective_id,
  );
  if (!event) throw notFound('Événement introuvable.');
  return event;
}

const label = (value) => (typeof value === 'string' ? value.trim().slice(0, LABEL_MAX) : '');

function scanInput(req, eventId, raw, offline) {
  if (typeof raw?.text !== 'string' || !raw.text.trim() || raw.text.length > SCAN_TEXT_MAX) {
    throw badRequest('invalid_scan', 'Code de billet invalide.');
  }
  return {
    eventId,
    text: raw.text,
    deviceId: label(req.body.deviceId) || 'inconnu',
    gate: label(raw.gate ?? req.body.gate),
    clientScanId: label(raw.clientScanId) || crypto.randomUUID(),
    scannedAt: raw.scannedAt,
    offline,
    userId: req.user.id,
  };
}

scanRouter.get('/events', (req, res) => {
  const since = new Date(clock.now().getTime() - RECENT_EVENTS_HOURS * 3_600_000).toISOString();
  res.json(
    all(
      `SELECT id, title, starts_at AS startsAt, timezone, venue, is_online AS isOnline FROM events
       WHERE collective_id = ? AND status = 'published' AND starts_at > ? ORDER BY starts_at LIMIT ?`,
      req.user.collective_id,
      since,
      EVENTS_SHOWN,
    ).map((e) => ({ ...e, isOnline: Boolean(e.isOnline) })),
  );
});

scanRouter.get('/events/:id/manifest', (req, res) => {
  const event = ownPublishedEvent(req);
  res.json({
    event: { id: event.id, title: event.title, startsAt: event.starts_at, timezone: event.timezone, venue: event.venue },
    ticketTypes: ticketTypesOf(event.id).map((t) => ({ id: t.id, name: t.name })),
    tickets: manifest(event.id),
    generatedAt: clock.nowIso(),
  });
});

// Contrôle en ligne : réponse immédiate et définitive.
scanRouter.post('/events/:id/check', (req, res) => {
  const event = ownPublishedEvent(req);
  res.json(recordScan(scanInput(req, event.id, req.body ?? {}, false)));
});

// Synchronisation des scans faits hors ligne. Renvoie aussi la liste à jour des entrées
// pour que chaque téléphone connaisse les billets validés aux autres portes.
scanRouter.post('/events/:id/sync', (req, res) => {
  const event = ownPublishedEvent(req);
  const scans = req.body?.scans;
  if (!Array.isArray(scans) || scans.length > MAX_SCANS_PER_SYNC) throw badRequest('invalid_scans', 'Liste de scans invalide.');
  const inputs = scans.map((s) => scanInput(req, event.id, s, true));
  res.json({ results: inputs.map(recordScan), entries: entriesOf(event.id), syncedAt: clock.nowIso() });
});
