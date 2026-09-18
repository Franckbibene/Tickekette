import { Router } from 'express';
import { all } from '../../db.js';
import { formatDateTime, toCsv } from '../../format.js';
import { ownEvent } from './ownership.js';

const PROVIDER_LABELS = { mockpay: 'Carte', transfer: 'Virement', free: 'Gratuit' };
const ACCOUNTING_TIMEZONE = 'Europe/Paris';

function sendCsv(res, filename, csv) {
  res.set('Content-Type', 'text/csv; charset=utf-8');
  res.set('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(csv);
}

// Nom de fichier sûr (aucun guillemet ni retour à la ligne dans l'en-tête HTTP).
const slugify = (s) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase()
    .slice(0, 60) || 'evenement';

const euros = (cents) => (cents / 100).toFixed(2).replace('.', ',');

export const exportsRouter = Router();

// (H11) Colonnes demandées par les salles : nom, type de place, référence, code, entrée.
exportsRouter.get('/events/:id/participants.csv', (req, res) => {
  const event = ownEvent(req);
  const rows = all(
    `SELECT t.holder_name, o.buyer_email, tt.name AS type, t.code, o.reference, t.entered_at
     FROM tickets t JOIN orders o ON o.id = t.order_id JOIN ticket_types tt ON tt.id = t.ticket_type_id
     WHERE t.event_id = ? AND t.status = 'valid' ORDER BY t.holder_name COLLATE NOCASE, t.id`,
    event.id,
  );
  const csv = toCsv(rows, [
    { label: 'Nom', value: (r) => r.holder_name },
    { label: 'E-mail', value: (r) => r.buyer_email },
    { label: 'Type de place', value: (r) => r.type },
    { label: 'Référence commande', value: (r) => r.reference },
    { label: 'Code billet', value: (r) => r.code },
    { label: 'Entré à', value: (r) => (r.entered_at ? formatDateTime(r.entered_at, event.timezone) : '') },
  ]);
  sendCsv(res, `participants-${slugify(event.title)}.csv`, csv);
});

exportsRouter.get('/accounting.csv', (req, res) => {
  const rows = all(
    `SELECT p.created_at, e.title, o.reference, o.buyer_name, p.kind, p.provider, p.provider_payment_id,
            p.amount_cents, p.fee_cents
     FROM payments p JOIN orders o ON o.id = p.order_id JOIN events e ON e.id = o.event_id
     WHERE o.collective_id = ? ORDER BY p.created_at, p.id`,
    req.user.collective_id,
  );
  const csv = toCsv(rows, [
    { label: 'Date', value: (r) => formatDateTime(r.created_at, ACCOUNTING_TIMEZONE) },
    { label: 'Événement', value: (r) => r.title },
    { label: 'Référence', value: (r) => r.reference },
    { label: 'Client', value: (r) => r.buyer_name },
    { label: 'Opération', value: (r) => (r.kind === 'payment' ? 'Paiement' : 'Remboursement') },
    { label: 'Moyen', value: (r) => PROVIDER_LABELS[r.provider] ?? r.provider },
    { label: 'Montant (€)', value: (r) => euros(r.kind === 'payment' ? r.amount_cents : -r.amount_cents) },
    { label: 'Frais (€)', value: (r) => euros(r.fee_cents) },
    { label: 'ID prestataire', value: (r) => r.provider_payment_id },
  ]);
  sendCsv(res, 'comptabilite.csv', csv);
});
