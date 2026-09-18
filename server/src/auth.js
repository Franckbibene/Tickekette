import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { config } from './config.js';
import { get } from './db.js';
import { forbidden, unauthorized } from './errors.js';

const BCRYPT_ROUNDS = 10;
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
  const token = jwt.sign({ uid: user.id }, config.jwtSecret, {
    algorithm: JWT_ALGORITHM,
    expiresIn: Math.floor(config.session.maxAgeMs / 1000),
  });
  res.cookie(config.session.cookieName, token, { ...cookieOptions(), maxAge: config.session.maxAgeMs });
}

export function closeSession(res) {
  res.clearCookie(config.session.cookieName, cookieOptions());
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
    /** @type {{ uid?: number }} */
    let payload;
    try {
      payload = /** @type {{ uid?: number }} */ (jwt.verify(token, config.jwtSecret, { algorithms: [JWT_ALGORITHM] }));
    } catch {
      throw unauthorized('Session expirée, reconnectez-vous.');
    }
    const user = get('SELECT id, name, email, role, collective_id FROM users WHERE id = ?', payload.uid);
    if (!user) throw unauthorized('Session expirée, reconnectez-vous.');
    if (roles.length && !roles.includes(user.role)) throw forbidden("Vous n'avez pas accès à cette page.");
    req.user = user;
    next();
  };
}
