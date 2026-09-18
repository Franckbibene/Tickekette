import crypto from 'node:crypto';
import { config } from '../config.js';

// 96 bits aléatoires : impossible à deviner.
export const newTicketCode = () => crypto.randomBytes(12).toString('base64url');

const signature = (code) => crypto.createHmac('sha256', config.ticketSecret).update(code).digest('base64url').slice(0, 12);

// Contenu du QR code : le code est signé, une capture retouchée est rejetée (5.6).
export const qrPayload = (code) => `TKK1.${code}.${signature(code)}`;

// Accepte le contenu complet d'un QR code ou un code saisi à la main.
export function parseScannedText(text) {
  const value = String(text ?? '').trim();
  if (!value.startsWith('TKK1.')) return { code: value, forged: false };
  const [, code, sig] = value.split('.');
  if (!code || !sig) return { code: null, forged: true };
  const expected = Buffer.from(signature(code));
  const received = Buffer.from(sig);
  const valid = expected.length === received.length && crypto.timingSafeEqual(expected, received);
  return { code, forged: !valid };
}
