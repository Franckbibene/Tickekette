import { run } from '../db.js';
import { clock } from '../clock.js';
import { config } from '../config.js';
import { cityOf, escapeHtml as e, formatDateTime, formatMoney } from '../format.js';

// Les mails sont écrits dans la boîte d'envoi (table emails) dans la même transaction
// que l'action qui les déclenche : pas de mail « billet » si le paiement est annulé.
export function sendMail({ to, subject, html, kind }) {
  // Le sujet contient des données saisies (titre d'événement…) : on retire tout retour à la ligne
  // pour empêcher l'injection d'en-têtes si un vrai serveur SMTP est branché en production.
  const safeSubject = String(subject).replace(/[\r\n]+/g, ' ').slice(0, 300);
  run('INSERT INTO emails (to_email, subject, html, kind, created_at) VALUES (?, ?, ?, ?, ?)', to, safeSubject, html, kind, clock.nowIso());
}

const L = (locale, fr, en) => (locale === 'en' ? en : fr);
const orderUrl = (order) => `${config.publicUrl}/commande/${order.token}`;

function layout(locale, body) {
  return `<!doctype html><html lang="${locale}"><body style="margin:0;background:#f5f1ea;font-family:system-ui,-apple-system,Segoe UI,sans-serif;color:#1f1a17">
<div style="max-width:560px;margin:0 auto;padding:24px 16px">
<div style="font-weight:800;font-size:20px;color:#9a3412;margin-bottom:16px">Tickekette</div>
<div style="background:#fff;border-radius:12px;padding:24px;line-height:1.5">${body}</div>
<p style="font-size:12px;color:#78716c;margin-top:16px">${L(locale, 'Mail automatique, merci de ne pas y répondre.', 'Automatic email, please do not reply.')}</p>
</div></body></html>`;
}

const button = (href, label) =>
  `<p><a href="${e(href)}" style="display:inline-block;background:#9a3412;color:#fff;text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:600">${e(label)}</a></p>`;

function when(event, locale) {
  const local = formatDateTime(event.starts_at, event.timezone, locale);
  const utc = new Date(event.starts_at).toISOString().slice(11, 16);
  return `${e(local)} <span style="color:#78716c">(${L(locale, 'heure de', 'time in')} ${e(cityOf(event.timezone))}, ${utc} UTC)</span>`;
}

const eventBlock = (event, locale) =>
  `<p style="margin:0 0 4px"><strong>${e(event.title)}</strong></p>
<p style="margin:0 0 16px">${when(event, locale)}<br>${e(event.is_online ? L(locale, 'En ligne', 'Online') : event.venue)}</p>`;

export function mailTransferInstructions(order, event, collective) {
  const l = order.locale;
  sendMail({
    to: order.buyer_email,
    kind: 'transfer_instructions',
    subject: L(l, `Réservation ${order.reference} : en attente de votre virement`, `Booking ${order.reference}: awaiting your transfer`),
    html: layout(
      l,
      `<p>${L(l, 'Bonjour', 'Hello')} ${e(order.buyer_name)},</p>${eventBlock(event, l)}
<p>${L(l, 'Vos places sont bloquées jusqu’au', 'Your seats are held until')} <strong>${e(formatDateTime(order.expires_at, event.timezone, l))}</strong>.
${L(l, 'Sans virement reçu à cette date, elles seront remises en vente.', 'If no transfer is received by then, they will be released.')}</p>
<p>${L(l, 'Montant', 'Amount')} : <strong>${formatMoney(order.total_cents, l)}</strong><br>IBAN : <strong>${e(collective.iban)}</strong><br>
${L(l, 'Référence à indiquer', 'Reference to include')} : <strong>${e(order.reference)}</strong></p>
${button(orderUrl(order), L(l, 'Voir ma réservation', 'View my booking'))}`,
    ),
  });
}

export function mailTickets(order, event, tickets) {
  const l = order.locale;
  const access = event.is_online
    ? `<p>${L(l, 'Lien d’accès à l’événement', 'Event access link')} : <a href="${e(event.online_url)}">${e(event.online_url)}</a></p>`
    : `<p>${L(l, 'Présentez le QR code de chaque billet à l’entrée (sur téléphone ou imprimé).', 'Show each ticket’s QR code at the entrance (on your phone or printed).')}</p>`;
  const list = tickets.map((t) => `<li>${e(t.ticket_type_name)} — ${L(l, 'code', 'code')} <code>${e(t.code)}</code></li>`).join('');
  sendMail({
    to: order.buyer_email,
    kind: 'tickets',
    subject: L(l, `Vos billets pour ${event.title}`, `Your tickets for ${event.title}`),
    html: layout(
      l,
      `<p>${L(l, 'Bonjour', 'Hello')} ${e(order.buyer_name)}, ${L(l, 'merci pour votre commande', 'thank you for your order')} ${e(order.reference)} !</p>
${eventBlock(event, l)}<ul>${list}</ul>${access}
${button(orderUrl(order), L(l, 'Afficher mes billets', 'Show my tickets'))}
<p style="font-size:13px;color:#78716c">${L(l, 'Chaque billet ne peut être scanné qu’une seule fois.', 'Each ticket can only be scanned once.')}</p>`,
    ),
  });
}

export function mailExpired(order, event) {
  const l = order.locale;
  sendMail({
    to: order.buyer_email,
    kind: 'expired',
    subject: L(l, `Réservation ${order.reference} expirée`, `Booking ${order.reference} expired`),
    html: layout(
      l,
      `<p>${L(l, 'Bonjour', 'Hello')} ${e(order.buyer_name)},</p>${eventBlock(event, l)}
<p>${L(l, 'Le paiement n’a pas été reçu dans le délai : les places ont été libérées.', 'Payment was not received in time: the seats have been released.')}</p>
${button(`${config.publicUrl}/evenements/${event.id}`, L(l, 'Revoir l’événement', 'View the event'))}`,
    ),
  });
}

const REFUND_REASONS = {
  buyer_cancelled: ['Vous avez annulé votre commande.', 'You cancelled your order.'],
  event_cancelled: ['L’événement est annulé par l’organisateur.', 'The event has been cancelled by the organiser.'],
  late_payment_sold_out: [
    'Votre paiement est arrivé après l’expiration de la réservation, et les places ont été vendues entre-temps.',
    'Your payment arrived after the booking expired, and the seats had been sold in the meantime.',
  ],
  duplicate_payment: ['Un paiement en double a été détecté.', 'A duplicate payment was detected.'],
  amount_mismatch: ['Le montant reçu ne correspond pas à la commande.', 'The amount received does not match the order.'],
};

export function mailRefund(order, event, reason, amountCents) {
  const l = order.locale;
  const [fr, en] = REFUND_REASONS[reason] ?? REFUND_REASONS.buyer_cancelled;
  const how =
    order.payment_method === 'card'
      ? L(l, 'Le remboursement apparaîtra sur votre carte sous 5 à 10 jours.', 'The refund will appear on your card within 5 to 10 days.')
      : L(l, 'L’organisateur vous remboursera par virement.', 'The organiser will refund you by bank transfer.');
  sendMail({
    to: order.buyer_email,
    kind: 'refund',
    subject: L(
      l,
      `Remboursement de ${formatMoney(amountCents, l)} — ${order.reference}`,
      `Refund of ${formatMoney(amountCents, l)} — ${order.reference}`,
    ),
    html: layout(l, `<p>${L(l, 'Bonjour', 'Hello')} ${e(order.buyer_name)},</p>${eventBlock(event, l)}<p>${L(l, fr, en)}</p><p>${how}</p>`),
  });
}

export function mailWaitlistJoined(entry, event, ticketTypeName, position) {
  const l = entry.locale;
  sendMail({
    to: entry.email,
    kind: 'waitlist_joined',
    subject: L(l, `Liste d’attente : ${event.title}`, `Waiting list: ${event.title}`),
    html: layout(
      l,
      `<p>${L(l, 'Bonjour', 'Hello')} ${e(entry.name)},</p>${eventBlock(event, l)}
<p>${L(l, 'Vous êtes inscrit·e sur la liste d’attente', 'You are on the waiting list for')} « ${e(ticketTypeName)} » (${entry.quantity} ${L(l, 'place(s)', 'seat(s)')}), ${L(l, 'en position', 'position')} <strong>${position}</strong>.</p>
<p>${L(l, 'Si une place se libère, vous recevrez un mail et aurez', 'If a seat becomes available, you will get an email and have')} ${Math.round(config.waitlistOfferMinutes / 60)} h ${L(l, 'pour payer.', 'to pay.')}</p>`,
    ),
  });
}

export function mailWaitlistOffer(order, event, quantity, requested) {
  const l = order.locale;
  const partial =
    quantity < requested
      ? `<p>${L(l, `Vous aviez demandé ${requested} places : seules ${quantity} sont disponibles pour l’instant.`, `You asked for ${requested} seats: only ${quantity} are available for now.`)}</p>`
      : '';
  sendMail({
    to: order.buyer_email,
    kind: 'waitlist_offer',
    subject: L(l, `Une place s’est libérée : ${event.title}`, `A seat is available: ${event.title}`),
    html: layout(
      l,
      `<p>${L(l, 'Bonne nouvelle', 'Good news')} ${e(order.buyer_name)} !</p>${eventBlock(event, l)}
<p>${L(l, `${quantity} place(s) vous sont réservées jusqu’au`, `${quantity} seat(s) are reserved for you until`)} <strong>${e(formatDateTime(order.expires_at, event.timezone, l))}</strong>.
${L(l, 'Passé ce délai, elles seront proposées à la personne suivante.', 'After that, they will be offered to the next person.')}</p>${partial}
${button(orderUrl(order), L(l, 'Payer mes places', 'Pay for my seats'))}`,
    ),
  });
}

export function mailWaitlistOfferExpired(order, event) {
  const l = order.locale;
  sendMail({
    to: order.buyer_email,
    kind: 'waitlist_offer_expired',
    subject: L(l, `Offre expirée : ${event.title}`, `Offer expired: ${event.title}`),
    html: layout(
      l,
      `<p>${L(l, 'Bonjour', 'Hello')} ${e(order.buyer_name)},</p>${eventBlock(event, l)}
<p>${L(l, 'Le délai pour payer la place proposée est dépassé : elle a été proposée à la personne suivante.', 'The time to pay for the offered seat has passed: it has been offered to the next person.')}</p>`,
    ),
  });
}
