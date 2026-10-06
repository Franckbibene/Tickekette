import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { config } from './config.js';
import { get, run } from './db.js';
import { unauthorized } from './errors.js';

const JWT_ALGORITHM = 'HS256';
const ISSUER = 'tickekette';
const AUDIENCE = 'order-access';

export const hashOrderToken = (token) => crypto.createHash('sha256').update(token).digest('hex');

const cookieOptions = () => ({
  httpOnly: true,
  secure: config.secureCookies,
  sameSite: 'strict',
  path: '/api/orders',
});

export function issueOrderAccessToken(order, event) {
  const token = crypto.randomBytes(24).toString('base64url');
  const expiresAt = new Date(Math.max(Date.parse(event.starts_at) + 30 * 86_400_000, Date.now() + 86_400_000)).toISOString();
  run(
    'INSERT INTO order_access_tokens (token_hash, order_id, expires_at, created_at) VALUES (?, ?, ?, ?)',
    hashOrderToken(token),
    order.id,
    expiresAt,
    new Date().toISOString(),
  );
  return token;
}

export function exchangeOrderToken(res, token) {
  const access = get(
    `SELECT oat.order_id FROM order_access_tokens oat
     JOIN orders o ON o.id = oat.order_id
     WHERE oat.token_hash = ? AND oat.expires_at > ?`,
    hashOrderToken(token),
    new Date().toISOString(),
  );
  if (!access) throw unauthorized('Lien de commande invalide ou expiré.');
  const session = jwt.sign({ oid: access.order_id, purpose: AUDIENCE }, config.jwtSecret, {
    algorithm: JWT_ALGORITHM,
    audience: AUDIENCE,
    issuer: ISSUER,
    expiresIn: Math.floor(config.orderAccess.maxAgeMs / 1000),
    jwtid: crypto.randomUUID(),
  });
  res.cookie(config.orderAccess.cookieName, session, { ...cookieOptions(), maxAge: config.orderAccess.maxAgeMs });
  return get('SELECT * FROM orders WHERE id = ?', access.order_id);
}

export function requireOrderAccess(req, _res, next) {
  const token = req.cookies?.[config.orderAccess.cookieName];
  if (!token) throw unauthorized('Accès à la commande requis.');
  try {
    const payload = jwt.verify(token, config.jwtSecret, {
      algorithms: [JWT_ALGORITHM],
      audience: AUDIENCE,
      issuer: ISSUER,
    });
    if (typeof payload === 'string' || payload.purpose !== AUDIENCE || !Number.isSafeInteger(payload.oid)) {
      throw new Error('invalid order session');
    }
    const order = get('SELECT * FROM orders WHERE id = ?', payload.oid);
    if (!order) throw new Error('missing order');
    req.order = order;
    next();
  } catch {
    throw unauthorized('Accès à la commande expiré.');
  }
}

export function noStore(_req, res, next) {
  res.set('Cache-Control', 'no-store, private');
  res.set('Pragma', 'no-cache');
  next();
}
