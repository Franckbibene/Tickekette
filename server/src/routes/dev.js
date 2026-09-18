import { Router } from 'express';
import { all, get } from '../db.js';
import { clock } from '../clock.js';
import { notFound } from '../errors.js';
import { sweepExpired } from '../services/sales.js';

// Outils de démonstration, désactivés en production :
// boîte mail de test et horloge accélérable (pour montrer l'expiration des réservations).
export const devRouter = Router();

devRouter.get('/emails', (_req, res) => {
  res.json(all('SELECT id, to_email AS "to", subject, kind, created_at AS createdAt FROM emails ORDER BY id DESC LIMIT 200'));
});

devRouter.get('/emails/:id', (req, res) => {
  const mail = get('SELECT id, to_email AS "to", subject, kind, html, created_at AS createdAt FROM emails WHERE id = ?', Number(req.params.id));
  if (!mail) throw notFound();
  res.json(mail);
});

devRouter.get('/clock', (_req, res) => {
  res.json({ now: clock.nowIso(), offsetMinutes: Math.round(clock.offset() / 60_000) });
});

devRouter.post('/clock/advance', (req, res) => {
  const minutes = Math.max(0, Math.min(Number(req.body?.minutes) || 0, 60 * 24 * 30));
  clock.advance(minutes * 60_000);
  const expired = sweepExpired();
  res.json({ now: clock.nowIso(), offsetMinutes: Math.round(clock.offset() / 60_000), expired });
});

devRouter.post('/clock/reset', (_req, res) => {
  clock.reset();
  res.json({ now: clock.nowIso(), offsetMinutes: 0 });
});
