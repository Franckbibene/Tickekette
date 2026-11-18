import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const env = process.env;
const APP_MODES = new Set(['production', 'demo', 'test']);
const appMode = env.APP_MODE;
if (!APP_MODES.has(appMode)) {
  throw new Error('APP_MODE doit être explicitement défini à production, demo ou test.');
}
const isProduction = appMode === 'production';
const isDemo = appMode === 'demo';
const isTest = appMode === 'test';
const dataDir = fileURLToPath(new URL('../data/', import.meta.url));

const MIN_SECRET_LENGTH = 32;
const ephemeralSecrets = new Map();

function secret(name) {
  const value = env[name];
  if (value && value.length >= MIN_SECRET_LENGTH) return value;
  if (isProduction || isDemo) {
    throw new Error(`${name} doit être défini (${MIN_SECRET_LENGTH} caractères minimum) en mode ${appMode}.`);
  }
  // Les tests isolés utilisent une valeur aléatoire propre au processus, jamais un
  // secret public forgeable. Les modes persistants exigent des secrets explicites.
  if (!ephemeralSecrets.has(name)) ephemeralSecrets.set(name, crypto.randomBytes(32).toString('hex'));
  return ephemeralSecrets.get(name);
}

function flag(name, defaultValue) {
  if (env[name] === undefined) return defaultValue;
  return env[name] === 'true';
}

const paymentProvider = env.PAYMENT_PROVIDER ?? 'none';
if (!['none', 'mock'].includes(paymentProvider)) throw new Error('PAYMENT_PROVIDER doit valoir none ou mock.');
if (paymentProvider === 'mock' && !isDemo && !isTest) throw new Error('Le prestataire simulé est réservé au mode demo/test.');

const devTools = flag('ENABLE_DEV_TOOLS', false);
const demoData = flag('ALLOW_DEMO_DATA', false);
if ((devTools || demoData) && !isDemo && !isTest) throw new Error('Les fonctions de démonstration sont réservées au mode demo/test.');

const LOOPBACK_HOSTS = new Set(['127.0.0.1', '::1', 'localhost']);
const LOOPBACK_URL_HOSTS = new Set([...LOOPBACK_HOSTS, '[::1]']);
const host = env.HOST || '127.0.0.1';
if (!LOOPBACK_HOSTS.has(host)) {
  throw new Error('Cette application locale doit écouter uniquement sur localhost/loopback.');
}

function localUrl(name, value) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${name} doit être une URL locale http(s) valide.`);
  }
  if (!['http:', 'https:'].includes(parsed.protocol) || !LOOPBACK_URL_HOSTS.has(parsed.hostname) || parsed.username || parsed.password) {
    throw new Error(`${name} doit cibler exclusivement localhost/loopback en http(s).`);
  }
  return parsed.origin;
}

const publicUrl = localUrl('PUBLIC_URL', env.PUBLIC_URL ?? 'http://localhost:5173');
const apiUrl = env.API_URL ? localUrl('API_URL', env.API_URL) : '';
if (env.TRUST_PROXY !== undefined && env.TRUST_PROXY !== '0') throw new Error('TRUST_PROXY doit rester à 0 pour une application locale.');

// Les valeurs marquées (H…) sont des hypothèses du cahier des charges, voir HYPOTHESES.md.
export const config = {
  appMode,
  isProduction,
  isDemo,
  isTest,
  // En dev, PORT est souvent déjà pris par le front : l'API a sa propre variable.
  port: Number(env.API_PORT) || (isProduction && Number(env.PORT)) || 3001,
  host,
  // Aucun proxy n'est autorisé dans le modèle local mono-instance.
  trustProxy: 0,
  dataDir,
  dbFile: env.DB_FILE || `${dataDir}tickekette.db`,
  jwtSecret: secret('JWT_SECRET'),
  ticketSecret: secret('TICKET_SECRET'),
  webhookSecret: secret('WEBHOOK_SECRET'),
  dataEncryptionKey: secret('DATA_ENCRYPTION_KEY'),
  // URL du front, utilisée dans les liens des mails.
  publicUrl,
  secureCookies: publicUrl.startsWith('https://'),
  // URL de l'API, utilisée par le prestataire simulé pour envoyer ses notifications.
  apiUrl,
  // 'mock' : prestataire simulé, uniquement en mode demo/test. 'none' : indisponible.
  paymentProvider,
  devTools,
  demoData,

  session: {
    cookieName: 'tkk_session',
    maxAgeMs: 12 * 3_600_000,
  },

  orderAccess: {
    cookieName: 'tkk_order_access',
    maxAgeMs: 2 * 3_600_000,
  },

  offline: {
    // Autorisation hors ligne courte : limite l'usage d'un terminal ou compte révoqué.
    grantMinutes: 8 * 60,
  },

  // (H3) Délai de paiement d'une réservation selon le moyen de paiement.
  holdMinutes: { card: 10, transfer: 48 * 60 },
  // (H4) Le virement n'est plus proposé à moins de 72 h de l'événement.
  transferClosesHoursBefore: 72,
  // (H7) Délai laissé à une personne de la liste d'attente pour payer.
  waitlistOfferMinutes: 120,
  // Fréquence de libération des réservations expirées.
  sweepIntervalMs: 10_000,
  // Frais simulés du prestataire de paiement (carte).
  cardFee: { percent: 1.4, fixedCents: 25 },
};
