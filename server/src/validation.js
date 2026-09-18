import { badRequest, notFound } from './errors.js';

// Validation des entrées côté serveur : tout ce qui vient du navigateur est non fiable.
// Chaque fonction renvoie une valeur normalisée ou lève une erreur 400 explicite.

export const LIMITS = {
  name: 120,
  email: 254,
  title: 160,
  description: 4000,
  venue: 200,
  url: 500,
  slug: 40,
  passwordMin: 8,
  // bcrypt ignore silencieusement tout ce qui dépasse 72 octets.
  passwordMaxBytes: 72,
  priceCentsMax: 100_000_00,
  quotaMax: 100_000,
  ticketTypesMax: 20,
  maxPerOrderMax: 50,
  cancelDeadlineHoursMax: 24 * 60,
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const TOKEN_RE = /^[A-Za-z0-9_-]{16,64}$/;
const SLUG_RE = /^[a-z0-9-]{2,40}$/;

export function text(value, { field, max, required = true }) {
  const s = typeof value === 'string' ? value.trim() : '';
  if (required && !s) throw badRequest('invalid_input', `${field} : champ obligatoire.`);
  if (s.length > max) throw badRequest('invalid_input', `${field} : ${max} caractères maximum.`);
  return s;
}

export function email(value, field = 'E-mail') {
  const s = text(value, { field, max: LIMITS.email }).toLowerCase();
  if (!EMAIL_RE.test(s)) throw badRequest('invalid_email', 'Adresse e-mail invalide.');
  return s;
}

export function password(value) {
  const s = typeof value === 'string' ? value : '';
  if (s.length < LIMITS.passwordMin) throw badRequest('weak_password', `Mot de passe : ${LIMITS.passwordMin} caractères minimum.`);
  if (Buffer.byteLength(s) > LIMITS.passwordMaxBytes) throw badRequest('invalid_password', 'Mot de passe trop long.');
  return s;
}

export function integer(value, { field, min, max }) {
  const n = typeof value === 'number' ? value : typeof value === 'string' && value.trim() !== '' ? Number(value) : NaN;
  if (!Number.isInteger(n) || n < min || n > max) {
    throw badRequest('invalid_number', `${field} : nombre entier entre ${min} et ${max} attendu.`);
  }
  return n;
}

export function optionalInteger(value, options) {
  return value === null || value === undefined || value === '' ? null : integer(value, options);
}

export function oneOf(value, allowed, field) {
  if (!allowed.includes(value)) throw badRequest('invalid_input', `${field} : valeur non autorisée.`);
  return value;
}

export function httpUrl(value, field) {
  const s = text(value, { field, max: LIMITS.url });
  let url;
  try {
    url = new URL(s);
  } catch {
    throw badRequest('invalid_url', `${field} : adresse invalide.`);
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw badRequest('invalid_url', `${field} : http(s) uniquement.`);
  return url.toString();
}

export function isoDate(value, field) {
  const d = typeof value === 'string' ? new Date(value) : new Date(NaN);
  if (Number.isNaN(d.getTime())) throw badRequest('invalid_date', `${field} : date invalide.`);
  return d;
}

export function slug(value) {
  const s = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (!SLUG_RE.test(s)) throw badRequest('invalid_slug', 'Identifiant : 2 à 40 lettres minuscules, chiffres ou tirets.');
  return s;
}

export const isSlug = (value) => typeof value === 'string' && SLUG_RE.test(value);

// Identifiant numérique dans l'URL : un identifiant mal formé répond comme une ressource absente.
export function routeId(value) {
  const n = Number(value);
  if (!/^\d{1,10}$/.test(String(value)) || !Number.isSafeInteger(n) || n < 1) throw notFound();
  return n;
}

// Jeton secret dans l'URL (lien de commande, session de paiement).
export function routeToken(value) {
  if (typeof value !== 'string' || !TOKEN_RE.test(value.replace(/^cs_/, ''))) throw notFound();
  return value;
}

export function isValidTimeZone(tz) {
  if (typeof tz !== 'string' || tz.length > 64) return false;
  try {
    new Intl.DateTimeFormat('fr-FR', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

// Clé d'idempotence envoyée par le client pour éviter les doubles commandes (double clic, retry).
export function idempotencyKey(value) {
  if (value === undefined) return null;
  if (typeof value !== 'string' || !/^[A-Za-z0-9-]{16,64}$/.test(value)) {
    throw badRequest('invalid_idempotency_key', 'Clé d’idempotence invalide.');
  }
  return value;
}
