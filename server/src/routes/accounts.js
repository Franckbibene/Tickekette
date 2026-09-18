import { Router } from 'express';
import { all, get, run, tx } from '../db.js';
import { clock } from '../clock.js';
import { checkPassword, hashPassword, publicUser, requireAuth, signToken } from '../auth.js';
import { HttpError, badRequest, conflict } from '../errors.js';

export const authRouter = Router();

authRouter.post('/login', (req, res) => {
  const email = String(req.body?.email ?? '').trim().toLowerCase();
  const user = get('SELECT * FROM users WHERE email = ?', email);
  if (!user || !checkPassword(String(req.body?.password ?? ''), user.password_hash)) {
    throw new HttpError(401, 'bad_credentials', 'E-mail ou mot de passe incorrect.');
  }
  res.json({ token: signToken(user), user: publicUser(user) });
});

authRouter.get('/me', requireAuth(), (req, res) => {
  res.json(publicUser(req.user));
});

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
  const name = String(b.name ?? '').trim();
  const slug = String(b.slug ?? '').trim().toLowerCase();
  const color = /^#[0-9a-fA-F]{6}$/.test(b.color ?? '') ? b.color : '#9a3412';
  const iban = String(b.iban ?? '').trim();
  const adminName = String(b.adminName ?? '').trim();
  const adminEmail = String(b.adminEmail ?? '').trim().toLowerCase();
  const adminPassword = String(b.adminPassword ?? '');
  if (!name) throw badRequest('invalid_name', 'Nom du collectif obligatoire.');
  if (!/^[a-z0-9-]{2,40}$/.test(slug)) throw badRequest('invalid_slug', 'Identifiant : lettres minuscules, chiffres et tirets.');
  if (!adminName || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(adminEmail)) throw badRequest('invalid_admin', 'Nom et e-mail de l’admin obligatoires.');
  if (adminPassword.length < 8) throw badRequest('weak_password', 'Mot de passe : 8 caractères minimum.');
  if (get('SELECT id FROM collectives WHERE slug = ?', slug)) throw conflict('slug_taken', 'Identifiant déjà utilisé.');
  if (get('SELECT id FROM users WHERE email = ?', adminEmail)) throw conflict('email_taken', 'Cet e-mail est déjà utilisé.');
  const id = tx(() => {
    const now = clock.nowIso();
    const { lastInsertRowid } = run(
      'INSERT INTO collectives (name, slug, color, iban, created_at) VALUES (?, ?, ?, ?, ?)',
      name,
      slug,
      color,
      iban,
      now,
    );
    const collectiveId = Number(lastInsertRowid);
    run(
      "INSERT INTO users (collective_id, email, password_hash, name, role, created_at) VALUES (?, ?, ?, ?, 'admin', ?)",
      collectiveId,
      adminEmail,
      hashPassword(adminPassword),
      adminName,
      now,
    );
    return collectiveId;
  });
  res.status(201).json(get('SELECT id, name, slug, color FROM collectives WHERE id = ?', id));
});
