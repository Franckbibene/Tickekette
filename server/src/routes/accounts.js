import { Router } from 'express';
import { all, get, run, tx } from '../db.js';
import { clock } from '../clock.js';
import {
  clearAuthenticationFailures,
  closeMfaSetupSession,
  closeSession,
  hashPassword,
  openMfaSetupSession,
  openSession,
  publicUser,
  recordAuthenticationFailure,
  requireAuth,
  requireMfaSetup,
  verifyCredentials,
} from '../auth.js';
import { HttpError, conflict } from '../errors.js';
import { LIMITS, email, password, slug, text } from '../validation.js';
import { mfaSetup, requiresMfa, verifyMfa } from '../services/mfa.js';

const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;
const DEFAULT_COLOR = '#9a3412';
const IBAN_MAX = 42;

export function authRouter(limits) {
  const router = Router();

  router.post('/login', limits.login, async (req, res) => {
    // Pas de validation détaillée ici : le message reste identique quelle que soit l'erreur,
    // pour ne pas indiquer si un compte existe.
    const address = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase().slice(0, LIMITS.email) : '';
    const secret = typeof req.body?.password === 'string' ? req.body.password.slice(0, 200) : '';
    const result = address && secret ? verifyCredentials(address, secret) : { user: null, blocked: false };
    if (!result.user) {
      if (result.blocked) throw new HttpError(429, 'login_delayed', 'Trop de tentatives. Réessayez plus tard.');
      throw new HttpError(401, 'bad_credentials', 'E-mail ou mot de passe incorrect.');
    }
    const user = result.user;
    if (requiresMfa(user)) {
      if (!user.mfa_enabled) {
        openMfaSetupSession(res, user);
        return res.status(202).json({ mfaRequired: true, setupRequired: true });
      }
      if (typeof req.body?.otp !== 'string') return res.status(202).json({ mfaRequired: true, setupRequired: false });
      if (!(await verifyMfa(user, req.body.otp))) {
        recordAuthenticationFailure(user);
        throw new HttpError(401, 'bad_credentials', 'E-mail, mot de passe ou code incorrect.');
      }
    }
    clearAuthenticationFailures(user.id);
    openSession(res, user);
    return res.json(publicUser(user));
  });

  router.get('/mfa/setup', requireMfaSetup, (req, res) => {
    res.set('Cache-Control', 'no-store');
    if (!requiresMfa(req.mfaUser) || req.mfaUser.mfa_enabled) throw new HttpError(409, 'mfa_already_configured', 'MFA déjà configurée.');
    res.json(mfaSetup(req.mfaUser.id));
  });

  router.post('/mfa/confirm', limits.login, requireMfaSetup, async (req, res) => {
    const user = get('SELECT * FROM users WHERE id = ?', req.mfaUser.id);
    if (!(await verifyMfa(user, req.body?.otp, { enable: true }))) {
      recordAuthenticationFailure(user);
      throw new HttpError(401, 'bad_credentials', 'Code incorrect.');
    }
    clearAuthenticationFailures(user.id);
    closeMfaSetupSession(res);
    openSession(res, user);
    res.json(publicUser(user));
  });

  router.post('/logout', requireAuth(), (req, res) => {
    closeSession(res, req.user.id);
    res.status(204).end();
  });

  router.get('/me', requireAuth(), (req, res) => {
    res.json(publicUser(req.user));
  });

  return router;
}

// Super-administration de la plateforme (3.4 / 4.4).
// (H2) Le super-admin gère les collectifs et leurs comptes, mais n'a accès à aucun chiffre de vente.
export const platformRouter = Router();
platformRouter.use(requireAuth('superadmin'));

platformRouter.get('/collectives', (_req, res) => {
  res.json(
    all(
      `SELECT c.id, c.name, c.slug, c.color, c.created_at AS createdAt,
              (SELECT COUNT(*) FROM events e WHERE e.collective_id = c.id) AS eventsCount,
              (SELECT COUNT(*) FROM users u WHERE u.collective_id = c.id) AS usersCount
       FROM collectives c ORDER BY c.name`,
    ),
  );
});

platformRouter.post('/collectives', (req, res) => {
  const b = req.body ?? {};
  const input = {
    name: text(b.name, { field: 'Nom du collectif', max: LIMITS.name }),
    slug: slug(b.slug),
    color: typeof b.color === 'string' && HEX_COLOR_RE.test(b.color) ? b.color : DEFAULT_COLOR,
    iban: text(b.iban, { field: 'IBAN', max: IBAN_MAX, required: false }),
    adminName: text(b.adminName, { field: 'Nom de l’admin', max: LIMITS.name }),
    adminEmail: email(b.adminEmail, 'E-mail de l’admin'),
    adminPassword: password(b.adminPassword),
  };
  if (get('SELECT id FROM collectives WHERE slug = ?', input.slug)) throw conflict('slug_taken', 'Identifiant déjà utilisé.');
  if (get('SELECT id FROM users WHERE email = ?', input.adminEmail)) throw conflict('email_taken', 'Cet e-mail est déjà utilisé.');
  const id = tx(() => {
    const now = clock.nowIso();
    const { lastInsertRowid } = run(
      'INSERT INTO collectives (name, slug, color, iban, created_at) VALUES (?, ?, ?, ?, ?)',
      input.name,
      input.slug,
      input.color,
      input.iban,
      now,
    );
    const collectiveId = Number(lastInsertRowid);
    run(
      "INSERT INTO users (collective_id, email, password_hash, name, role, created_at) VALUES (?, ?, ?, ?, 'admin', ?)",
      collectiveId,
      input.adminEmail,
      hashPassword(input.adminPassword),
      input.adminName,
      now,
    );
    return collectiveId;
  });
  res.status(201).json(get('SELECT id, name, slug, color FROM collectives WHERE id = ?', id));
});
