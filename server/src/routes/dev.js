import { Router } from 'express';
import { all, get } from '../db.js';
import { clock } from '../clock.js';
import { notFound } from '../errors.js';
import { sweepExpired } from '../services/orders.js';
import { integer, routeId } from '../validation.js';

const MAX_ADVANCE_MINUTES = 60 * 24 * 30;
const EMAILS_SHOWN = 200;

// Outils de DÉMONSTRATION : boîte mail de test et horloge accélérable.
// Montés uniquement si config.devTools (jamais en production, voir config.js) :
// les mails contiennent les liens secrets des commandes.
export const devRouter = Router();

devRouter.get('/emails', (_req, res) => {
  res.json(all('SELECT id, to_email AS "to", subject, kind, created_at AS createdAt FROM emails ORDER BY id DESC LIMIT ?', EMAILS_SHOWN));
});

devRouter.get('/emails/:id', (req, res) => {
  const mail = get(
    'SELECT id, to_email AS "to", subject, kind, html, created_at AS createdAt FROM emails WHERE id = ?',
    routeId(req.params.id),
  );
  if (!mail) throw notFound();
  res.json(mail);
});

const clockState = () => ({ now: clock.nowIso(), offsetMinutes: Math.round(clock.offset() / 60_000) });

devRouter.get('/clock', (_req, res) => {
  res.json(clockState());
});

devRouter.post('/clock/advance', (req, res) => {
  const minutes = integer(req.body?.minutes, { field: 'Minutes', min: 1, max: MAX_ADVANCE_MINUTES });
  clock.advance(minutes * 60_000);
  const expired = sweepExpired();
  res.json({ ...clockState(), expired });
});

devRouter.post('/clock/reset', (_req, res) => {
  clock.reset();
  res.json(clockState());
});
