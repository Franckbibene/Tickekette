import { fileURLToPath } from 'node:url';

const dataDir = fileURLToPath(new URL('../data/', import.meta.url));

// Les valeurs marquées (H…) sont des hypothèses du cahier des charges (section 12),
// à valider avec le client. Voir HYPOTHESES.md.
const isProduction = process.env.NODE_ENV === 'production';

export const config = {
  // En dev, PORT est souvent déjà pris par le front : l'API a sa propre variable.
  port: Number(process.env.API_PORT) || (isProduction && Number(process.env.PORT)) || 3001,
  dataDir,
  dbFile: process.env.DB_FILE || `${dataDir}tickekette.db`,
  jwtSecret: process.env.JWT_SECRET || 'dev-jwt-secret-a-changer',
  ticketSecret: process.env.TICKET_SECRET || 'dev-ticket-secret-a-changer',
  webhookSecret: process.env.WEBHOOK_SECRET || 'dev-webhook-secret-a-changer',
  // URL du front, utilisée dans les liens des mails.
  publicUrl: process.env.PUBLIC_URL || 'http://localhost:5173',
  // URL de l'API, utilisée par le faux prestataire pour envoyer ses notifications.
  apiUrl: process.env.API_URL || '',
  isProduction,

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
