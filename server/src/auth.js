import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { config } from './config.js';
import { get, run } from './db.js';
import { forbidden, unauthorized } from './errors.js';

const BCRYPT_ROUNDS = 12;
const JWT_ALGORITHM = 'HS256';
const JWT_ISSUER = 'tickekette';
const SESSION_AUDIENCE = 'staff-session';

export const hashPassword = (password) => bcrypt.hashSync(password, BCRYPT_ROUNDS);

// Hash factice : la vérification prend le même temps que l'e-mail existe ou non
// (empêche de deviner quels comptes existent en mesurant le temps de réponse).
const DUMMY_HASH = hashPassword(crypto.randomBytes(16).toString('hex'));

function progressiveDelaySeconds(failures) {
  if (failures < 5) return 0;
  return Math.min(15 * 60, 30 * 2 ** Math.min(failures - 5, 5));
}

export function verifyCredentials(email, password) {
  const user = get('SELECT * FROM users WHERE email = ?', email);
  const ok = bcrypt.compareSync(password, user?.password_hash ?? DUMMY_HASH);
  if (!ok || !user) {
    if (user) recordAuthenticationFailure(user);
    return { user: null, blocked: false };
  }
  const blocked = user.login_blocked_until && user.login_blocked_until > new Date().toISOString();
  return { user: blocked ? null : user, blocked: Boolean(blocked) };
}

function recordAuthenticationFailure(user) {
  const failures = (user.failed_login_count ?? 0) + 1;
  const delay = progressiveDelaySeconds(failures);
  const blockedUntil = delay ? new Date(Date.now() + delay * 1000).toISOString() : null;
  run('UPDATE users SET failed_login_count = ?, login_blocked_until = ? WHERE id = ?', failures, blockedUntil, user.id);
}

export function clearAuthenticationFailures(userId) {
  run('UPDATE users SET failed_login_count = 0, login_blocked_until = NULL WHERE id = ?', userId);
}

// La session est un JWT dans un cookie HttpOnly : inaccessible au JavaScript de la page,
// donc non volable par une éventuelle faille XSS. SameSite=Strict bloque son envoi
// depuis un autre site (CSRF), complété par l'en-tête obligatoire vérifié dans app.js.
const cookieOptions = () => ({
  httpOnly: true,
  // Sur localhost HTTP, Secure empêcherait certains navigateurs d'envoyer le cookie.
  // Le serveur étant lié à loopback, le trafic ne quitte jamais la machine.
  secure: config.secureCookies,
  sameSite: 'strict',
  path: '/api',
});

export function openSession(res, user) {
  run('UPDATE users SET session_version = session_version + 1 WHERE id = ?', user.id);
  const current = get('SELECT session_version FROM users WHERE id = ?', user.id);
  const token = jwt.sign({ uid: user.id, sv: current.session_version }, config.jwtSecret, {
    algorithm: JWT_ALGORITHM,
    audience: SESSION_AUDIENCE,
    issuer: JWT_ISSUER,
    expiresIn: Math.floor(config.session.maxAgeMs / 1000),
    jwtid: crypto.randomUUID(),
  });
  res.cookie(config.session.cookieName, token, { ...cookieOptions(), maxAge: config.session.maxAgeMs });
}

export function closeSession(res, userId = null) {
  if (userId) run('UPDATE users SET session_version = session_version + 1 WHERE id = ?', userId);
  res.clearCookie(config.session.cookieName, cookieOptions());
}

// Déconnexion : invalide côté serveur tous les jetons de session en cours de l'utilisateur.
// Lit le jeton du cookie (pas d'authentification préalable sur /logout) ; si le jeton est
// déjà invalide ou absent, il n'y a rien à faire.
export function revokeSession(req) {
  const token = req.cookies?.[config.session.cookieName];
  if (!token) return;
  try {
    const { uid } = /** @type {{ uid?: number }} */ (jwt.verify(token, config.jwtSecret, { algorithms: [JWT_ALGORITHM] }));
    run('UPDATE users SET token_version = token_version + 1 WHERE id = ?', uid);
  } catch {
    /* jeton déjà expiré ou falsifié : rien à révoquer */
  }
}

export function publicUser(user) {
  const collective = user.collective_id ? get('SELECT id, name, slug, color FROM collectives WHERE id = ?', user.collective_id) : null;
  return { id: user.id, name: user.name, email: user.email, role: user.role, collective };
}

// Vérifie la session et le rôle à chaque requête. Le rôle et le collectif viennent
// toujours de la base, jamais de la requête : c'est ce qui garantit qu'un collectif
// ne voit que ses propres données (4.1) et qu'un compte supprimé perd l'accès aussitôt.
export function requireAuth(...roles) {
  return (req, _res, next) => {
    const token = req.cookies?.[config.session.cookieName];
    if (!token) throw unauthorized();
    /** @type {{ uid?: number, sv?: number }} */
    let payload;
    try {
      payload = /** @type {{ uid?: number, sv?: number }} */ (
        jwt.verify(token, config.jwtSecret, { algorithms: [JWT_ALGORITHM], audience: SESSION_AUDIENCE, issuer: JWT_ISSUER })
      );
    } catch {
      throw unauthorized('Session expirée, reconnectez-vous.');
    }
    const user = get('SELECT id, name, email, role, collective_id, session_version FROM users WHERE id = ?', payload.uid);
    if (!user || user.session_version !== payload.sv) throw unauthorized('Session expirée, reconnectez-vous.');
    if (roles.length && !roles.includes(user.role)) throw forbidden("Vous n'avez pas accès à cette page.");
    req.user = user;
    next();
  };
}
