import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { config } from './config.js';
import { get, run } from './db.js';
import { forbidden, unauthorized } from './errors.js';

const BCRYPT_ROUNDS = 12;
const JWT_ALGORITHM = 'HS256';

export const hashPassword = (password) => bcrypt.hashSync(password, BCRYPT_ROUNDS);

// Hash factice : la vérification prend le même temps que l'e-mail existe ou non
// (empêche de deviner quels comptes existent en mesurant le temps de réponse).
const DUMMY_HASH = hashPassword(crypto.randomBytes(16).toString('hex'));

export function verifyCredentials(email, password) {
  const user = get('SELECT * FROM users WHERE email = ?', email);
  const ok = bcrypt.compareSync(password, user?.password_hash ?? DUMMY_HASH);
  return ok && user ? user : null;
}

// La session est un JWT dans un cookie HttpOnly : inaccessible au JavaScript de la page,
// donc non volable par une éventuelle faille XSS. SameSite=Strict bloque son envoi
// depuis un autre site (CSRF), complété par l'en-tête obligatoire vérifié dans app.js.
const cookieOptions = () => ({
  httpOnly: true,
  secure: config.isProduction,
  sameSite: 'strict',
  path: '/api',
});

export function openSession(res, user) {
  // La version de jeton est embarquée dans la session : une déconnexion l'incrémente en base,
  // ce qui rend inacceptables les jetons déjà émis (vraie invalidation côté serveur).
  const token = jwt.sign({ uid: user.id, tv: user.token_version ?? 0 }, config.jwtSecret, {
    algorithm: JWT_ALGORITHM,
    expiresIn: Math.floor(config.session.maxAgeMs / 1000),
  });
  res.cookie(config.session.cookieName, token, { ...cookieOptions(), maxAge: config.session.maxAgeMs });
}

export function closeSession(res) {
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
    /** @type {{ uid?: number, tv?: number }} */
    let payload;
    try {
      payload = /** @type {{ uid?: number, tv?: number }} */ (jwt.verify(token, config.jwtSecret, { algorithms: [JWT_ALGORITHM] }));
    } catch {
      throw unauthorized('Session expirée, reconnectez-vous.');
    }
    const user = get('SELECT id, name, email, role, collective_id, token_version FROM users WHERE id = ?', payload.uid);
    if (!user) throw unauthorized('Session expirée, reconnectez-vous.');
    // Jeton d'une session révoquée (déconnexion) : refusé.
    if ((payload.tv ?? 0) !== user.token_version) throw unauthorized('Session expirée, reconnectez-vous.');
    if (roles.length && !roles.includes(user.role)) throw forbidden("Vous n'avez pas accès à cette page.");
    req.user = user;
    next();
  };
}
