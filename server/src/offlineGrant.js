import jwt from 'jsonwebtoken';
import { clock } from './clock.js';
import { config } from './config.js';
import { forbidden } from './errors.js';

const ALGORITHM = 'HS256';
const AUDIENCE = 'offline-manifest';
const ISSUER = 'tickekette';

export function issueOfflineGrant(user, event) {
  const nowSeconds = Math.floor(clock.now().getTime() / 1000);
  const configuredExpiry = nowSeconds + config.offline.grantMinutes * 60;
  const eventExpiry = Math.floor((Date.parse(event.starts_at) + 6 * 3_600_000) / 1000);
  const expires = Math.min(configuredExpiry, eventExpiry);
  const token = jwt.sign(
    { uid: user.id, sv: user.session_version, eid: event.id, cid: user.collective_id, purpose: AUDIENCE, iat: nowSeconds, exp: expires },
    config.jwtSecret,
    { algorithm: ALGORITHM, audience: AUDIENCE, issuer: ISSUER, noTimestamp: true },
  );
  return { token, expiresAt: new Date(expires * 1000).toISOString() };
}

export function verifyOfflineGrant(token, user, eventId) {
  try {
    const payload = jwt.verify(token, config.jwtSecret, {
      algorithms: [ALGORITHM],
      audience: AUDIENCE,
      issuer: ISSUER,
      clockTimestamp: Math.floor(clock.now().getTime() / 1000),
    });
    const valid =
      typeof payload !== 'string' &&
      payload.purpose === AUDIENCE &&
      payload.uid === user.id &&
      payload.sv === user.session_version &&
      payload.eid === eventId &&
      payload.cid === user.collective_id;
    if (!valid) throw new Error('grant mismatch');
  } catch {
    throw forbidden('Autorisation hors ligne invalide ou expirée. Rechargez la liste.');
  }
}
