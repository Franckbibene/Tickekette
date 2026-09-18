import { fileURLToPath } from 'node:url';

const env = process.env;
const isProduction = env.NODE_ENV === 'production';
const isTest = env.NODE_ENV === 'test';
const dataDir = fileURLToPath(new URL('../data/', import.meta.url));

// Valeurs de développement uniquement : refusées au démarrage en production.
const DEV_SECRETS = {
  JWT_SECRET: 'dev-only-jwt-secret-not-for-production-use',
  TICKET_SECRET: 'dev-only-ticket-secret-not-for-production-use',
  WEBHOOK_SECRET: 'dev-only-webhook-secret-not-for-production-use',
};
const MIN_SECRET_LENGTH = 32;

function secret(name) {
  const value = env[name];
  if (value && value.length >= MIN_SECRET_LENGTH) return value;
  if (isProduction) {
    throw new Error(`${name} doit être défini (${MIN_SECRET_LENGTH} caractères minimum) en production.`);
  }
  return DEV_SECRETS[name];
}

function flag(name, defaultValue) {
  if (env[name] === undefined) return defaultValue;
  return env[name] === 'true';
}

const paymentProvider = env.PAYMENT_PROVIDER ?? (isProduction ? 'none' : 'mock');
if (isProduction && paymentProvider === 'mock') {
  throw new Error('Le prestataire de paiement simulé ne peut pas être utilisé en production.');
}

const publicUrl = env.PUBLIC_URL ?? 'http://localhost:5173';
if (isProduction && !publicUrl.startsWith('https://')) {
  throw new Error('PUBLIC_URL doit être en HTTPS en production.');
}

// Les valeurs marquées (H…) sont des hypothèses du cahier des charges, voir HYPOTHESES.md.
export const config = {
  isProduction,
  isTest,
  // En dev, PORT est souvent déjà pris par le front : l'API a sa propre variable.
  port: Number(env.API_PORT) || (isProduction && Number(env.PORT)) || 3001,
  // Nombre de proxys devant l'application (nécessaire pour identifier l'IP réelle).
  trustProxy: Number(env.TRUST_PROXY) || 0,
  dataDir,
  dbFile: env.DB_FILE || `${dataDir}tickekette.db`,
  jwtSecret: secret('JWT_SECRET'),
  ticketSecret: secret('TICKET_SECRET'),
  webhookSecret: secret('WEBHOOK_SECRET'),
  // URL du front, utilisée dans les liens des mails.
  publicUrl,
  // URL de l'API, utilisée par le prestataire simulé pour envoyer ses notifications.
  apiUrl: env.API_URL || '',
  // 'mock' : prestataire simulé (démo). 'none' : paiement carte indisponible.
  paymentProvider,
  // Boîte mail de démo et horloge accélérable : jamais en production.
  devTools: !isProduction && flag('ENABLE_DEV_TOOLS', true),

  session: {
    cookieName: 'tkk_session',
    maxAgeMs: 12 * 3_600_000,
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
