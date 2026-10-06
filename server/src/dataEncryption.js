import crypto from 'node:crypto';
import { config } from './config.js';

const VERSION = 'v1';
const AAD = Buffer.from('tickekette-sensitive-data-v1');
const key = crypto.createHash('sha256').update(config.dataEncryptionKey).digest();

export function encryptData(value) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(AAD);
  const encrypted = Buffer.concat([cipher.update(String(value), 'utf8'), cipher.final()]);
  return [VERSION, iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), encrypted.toString('base64url')].join('.');
}

export function decryptData(value) {
  const [version, iv, tag, encrypted] = String(value ?? '').split('.');
  if (version !== VERSION || !iv || !tag || !encrypted) throw new Error('Donnée chiffrée invalide.');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'));
  decipher.setAAD(AAD);
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(encrypted, 'base64url')), decipher.final()]).toString('utf8');
}

export const isEncryptedData = (value) => typeof value === 'string' && value.startsWith(`${VERSION}.`);
