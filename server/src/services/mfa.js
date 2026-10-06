import { generateSecret, generateURI, verify } from 'otplib';
import { decryptData, encryptData } from '../dataEncryption.js';
import { get, run } from '../db.js';

const PRIVILEGED_ROLES = new Set(['admin', 'superadmin']);

export const requiresMfa = (user) => PRIVILEGED_ROLES.has(user.role);

export function mfaSetup(userId) {
  let user = get('SELECT * FROM users WHERE id = ?', userId);
  if (!user.mfa_secret_enc) {
    const secret = generateSecret({ length: 20 });
    run('UPDATE users SET mfa_secret_enc = ?, mfa_enabled = 0, mfa_last_step = -1 WHERE id = ?', encryptData(secret), userId);
    user = get('SELECT * FROM users WHERE id = ?', userId);
  }
  const secret = decryptData(user.mfa_secret_enc);
  return {
    secret,
    uri: generateURI({ issuer: 'Tickekette', label: user.email, secret }),
  };
}

export async function verifyMfa(user, token, { enable = false } = {}) {
  if (typeof token !== 'string' || !/^\d{6}$/.test(token) || !user.mfa_secret_enc) return false;
  const result = await verify({
    secret: decryptData(user.mfa_secret_enc),
    token,
    epochTolerance: [30, 0],
    ...(user.mfa_last_step >= 0 ? { afterTimeStep: user.mfa_last_step } : {}),
  });
  if (!result.valid || !('timeStep' in result)) return false;
  const updated = run(
    `UPDATE users SET mfa_last_step = ?, mfa_enabled = CASE WHEN ? THEN 1 ELSE mfa_enabled END
     WHERE id = ? AND mfa_last_step < ?`,
    result.timeStep,
    enable ? 1 : 0,
    user.id,
    result.timeStep,
  );
  // La condition atomique interdit deux validations concurrentes du même TOTP.
  return updated.changes === 1;
}
