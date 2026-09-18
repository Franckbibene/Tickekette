import crypto from 'node:crypto';
import { Router } from 'express';
import { all, get } from '../db.js';
import { clock } from '../clock.js';
import { requireAuth } from '../auth.js';
import { badRequest, notFound } from '../errors.js';
import { entriesOf, manifest, recordScan } from '../services/scans.js';
import { ticketTypesOf } from '../services/sales.js';

// Contrôle à l'entrée (5.7). Accessible aux contrôleurs et aux admins du collectif.
// Les contrôleurs n'ont accès à aucun chiffre de vente.
export const scanRouter = Router();
scanRouter.use(requireAuth('admin', 'controller'));

function ownEvent(req) {
  const event = get(
    "SELECT * FROM events WHERE id = ? AND collective_id = ? AND status = 'published'",
    Number(req.params.id),
    req.user.collective_id,
  );
  if (!event) throw notFound('Événement introuvable.');
  return event;
}

scanRouter.get('/events', (req, res) => {
  const since = new Date(clock.now().getTime() - 24 * 3_600_000).toISOString();
  res.json(
    all(
      `SELECT id, title, starts_at AS startsAt, timezone, venue, is_online AS isOnline FROM events
       WHERE collective_id = ? AND status = 'published' AND starts_at > ? ORDER BY starts_at LIMIT 20`,
      req.user.collective_id,
      since,
    ).map((e) => ({ ...e, isOnline: Boolean(e.isOnline) })),
  );
});

scanRouter.get('/events/:id/manifest', (req, res) => {
  const event = ownEvent(req);
  res.json({
    event: { id: event.id, title: event.title, startsAt: event.starts_at, timezone: event.timezone, venue: event.venue },
    ticketTypes: ticketTypesOf(event.id).map((t) => ({ id: t.id, name: t.name })),
    tickets: manifest(event.id),
    generatedAt: clock.nowIso(),
  });
});

const scanInput = (req, raw, offline) => ({
  eventId: Number(req.params.id),
  text: raw.text,
  deviceId: String(req.body.deviceId ?? 'inconnu').slice(0, 64),
  gate: String(raw.gate ?? req.body.gate ?? '').slice(0, 40),
  clientScanId: String(raw.clientScanId || crypto.randomUUID()).slice(0, 64),
  scannedAt: raw.scannedAt,
  offline,
  userId: req.user.id,
});

// Contrôle en ligne : réponse immédiate et définitive.
scanRouter.post('/events/:id/check', (req, res) => {
  ownEvent(req);
  res.json(recordScan(scanInput(req, req.body ?? {}, false)));
});

// Synchronisation des scans faits hors ligne. Renvoie aussi la liste à jour des entrées
// pour que chaque téléphone connaisse les billets validés aux autres portes.
scanRouter.post('/events/:id/sync', (req, res) => {
  const event = ownEvent(req);
  const scans = Array.isArray(req.body?.scans) ? req.body.scans : null;
  if (!scans || scans.length > 2000) throw badRequest('invalid_scans', 'Liste de scans invalide.');
  const results = scans.map((s) => recordScan(scanInput(req, s, true)));
  res.json({ results, entries: entriesOf(event.id), syncedAt: clock.nowIso() });
});
