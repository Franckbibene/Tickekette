import { Router } from 'express';
import { all, get } from '../db.js';
import { clock } from '../clock.js';
import { requireAuth } from '../auth.js';
import { badRequest, conflict, notFound } from '../errors.js';
import { issueOfflineGrant, verifyOfflineGrant } from '../offlineGrant.js';
import { ticketTypesOf } from '../services/inventory.js';
import { entriesOf, manifest, recordScan } from '../services/scans.js';
import { routeId } from '../validation.js';

const MAX_SCANS_PER_SYNC = 200;
const MAX_INVALID_SCANS_PER_DAY = 500;
const SCAN_TEXT_MAX = 200;
const LABEL_MAX = 64;
const RECENT_EVENTS_HOURS = 24;
const EVENTS_SHOWN = 20;
const OFFLINE_WINDOW_BEFORE_HOURS = 24;
const OFFLINE_WINDOW_AFTER_HOURS = 6;

// Contrôle à l'entrée (5.7). Accessible aux contrôleurs et aux admins du collectif.
// Les contrôleurs n'ont accès à aucun chiffre de vente.
export function scanRouter(limits) {
  const router = Router();
  router.use(requireAuth('admin', 'controller'));

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

  function assertOfflineWindow(event) {
    const startsAt = Date.parse(event.starts_at);
    const now = clock.now().getTime();
    if (now < startsAt - OFFLINE_WINDOW_BEFORE_HOURS * 3_600_000 || now > startsAt + OFFLINE_WINDOW_AFTER_HOURS * 3_600_000) {
      throw conflict('offline_window_closed', 'La liste hors ligne est disponible de 24 h avant à 6 h après l’événement.');
    }
  }

  function scanInput(req, eventId, raw, offline) {
    if (typeof raw?.text !== 'string' || !raw.text.trim() || raw.text.length > SCAN_TEXT_MAX) {
      throw badRequest('invalid_scan', 'Code de billet invalide.');
    }
    const clientScanId = label(raw.clientScanId);
    if (!/^[A-Za-z0-9_-]{8,64}$/.test(clientScanId)) {
      throw badRequest('invalid_scan_id', 'Identifiant de scan invalide.');
    }
    return {
      eventId,
      text: raw.text,
      deviceId: label(req.body.deviceId) || 'inconnu',
      gate: label(raw.gate ?? req.body.gate),
      clientScanId,
      scannedAt: raw.scannedAt,
      offline,
      userId: req.user.id,
    };
  }

  router.get('/events', (req, res) => {
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

  router.get('/events/:id/manifest', (req, res) => {
    const event = ownPublishedEvent(req);
    assertOfflineWindow(event);
    const grant = issueOfflineGrant(req.user, event);
    res.set('Cache-Control', 'no-store, private');
    res.json({
      event: { id: event.id, title: event.title, startsAt: event.starts_at, timezone: event.timezone, venue: event.venue },
      ticketTypes: ticketTypesOf(event.id).map((t) => ({ id: t.id, name: t.name })),
      tickets: manifest(event.id),
      generatedAt: clock.nowIso(),
      offlineGrant: grant.token,
      offlineExpiresAt: grant.expiresAt,
    });
  });

  // Contrôle en ligne : réponse immédiate et définitive.
  router.post('/events/:id/check', limits.scansUser, limits.scansDevice, (req, res) => {
    const event = ownPublishedEvent(req);
    res.json(recordScan(scanInput(req, event.id, req.body ?? {}, false)));
  });

  // Synchronisation des scans faits hors ligne. Renvoie aussi la liste à jour des entrées
  // pour que chaque téléphone connaisse les billets validés aux autres portes.
  router.post('/events/:id/sync', limits.scansUser, limits.scansDevice, (req, res) => {
    const event = ownPublishedEvent(req);
    verifyOfflineGrant(req.body?.offlineGrant, req.user, event.id);
    const scans = req.body?.scans;
    if (!Array.isArray(scans) || scans.length > MAX_SCANS_PER_SYNC) throw badRequest('invalid_scans', 'Liste de scans invalide.');
    const since = new Date(clock.now().getTime() - 86_400_000).toISOString();
    const invalid = get(
      `SELECT COUNT(*) AS n FROM scans WHERE event_id = ? AND user_id = ? AND device_id = ?
       AND received_at >= ? AND result = 'invalid'`,
      event.id,
      req.user.id,
      label(req.body?.deviceId) || 'inconnu',
      since,
    );
    if (invalid.n + scans.length > MAX_INVALID_SCANS_PER_DAY) {
      throw badRequest('invalid_scan_quota', 'Quota quotidien de scans atteint pour cet appareil.');
    }
    const inputs = scans.map((s) => {
      if (typeof s?.clientScanId !== 'string' || !/^[A-Za-z0-9_-]{8,64}$/.test(s.clientScanId)) {
        throw badRequest('invalid_scan_id', 'Identifiant de scan invalide.');
      }
      return scanInput(req, event.id, s, true);
    });
    res.json({ results: inputs.map(recordScan), entries: entriesOf(event.id), syncedAt: clock.nowIso() });
  });

  return router;
}
