import type { AdminEvent, EventInput } from '../types/api';
import { centsToEuroInput } from './format';
import { DEFAULT_TIMEZONE, isoToZonedInput, zonedInputToIso } from './timezones';
import { safeExternalUrl } from './url';
import { FIELD_LIMITS, parseEuros, parseInteger } from './validation';

// Formulaire de création / modification d'un événement : état saisi (chaînes de caractères),
// conversion vers le format de l'API et contrôle des erreurs de saisie.

export interface TicketTypeDraft {
  // Identifiant local stable pour les listes React (les nouveaux types n'ont pas encore d'id serveur).
  uid: string;
  id: number | null;
  name: string;
  price: string;
  quota: string;
  earlyPrice: string;
  earlyUntil: string;
  earlyQuota: string;
  sold: number;
  held: number;
}

export interface EventFormState {
  title: string;
  description: string;
  venue: string;
  isOnline: boolean;
  onlineUrl: string;
  timezone: string;
  startsAt: string;
  cancelDeadlineHours: string;
  maxPerOrder: string;
  types: TicketTypeDraft[];
}

export type EventFormErrors = Partial<
  Record<'title' | 'venue' | 'onlineUrl' | 'startsAt' | 'cancelDeadlineHours' | 'maxPerOrder', string>
> & {
  types?: Record<string, string>;
};

const DEFAULT_CANCEL_HOURS = '48';
const DEFAULT_MAX_PER_ORDER = '6';

export const newTicketTypeDraft = (name = ''): TicketTypeDraft => ({
  uid: crypto.randomUUID(),
  id: null,
  name,
  price: '',
  quota: '',
  earlyPrice: '',
  earlyUntil: '',
  earlyQuota: '',
  sold: 0,
  held: 0,
});

// (5.1) Il y a toujours au moins deux types de place : le formulaire en propose deux.
export const emptyEventForm = (): EventFormState => ({
  title: '',
  description: '',
  venue: '',
  isOnline: false,
  onlineUrl: '',
  timezone: DEFAULT_TIMEZONE,
  startsAt: '',
  cancelDeadlineHours: DEFAULT_CANCEL_HOURS,
  maxPerOrder: DEFAULT_MAX_PER_ORDER,
  types: [newTicketTypeDraft('Fosse'), newTicketTypeDraft('Balcon')],
});

export const eventFormFromEvent = (e: AdminEvent): EventFormState => ({
  title: e.title,
  description: e.description,
  venue: e.venue,
  isOnline: e.isOnline,
  onlineUrl: e.onlineUrl ?? '',
  timezone: e.timezone,
  startsAt: isoToZonedInput(e.startsAt, e.timezone),
  cancelDeadlineHours: String(e.cancelDeadlineHours),
  maxPerOrder: String(e.maxPerOrder),
  types: e.ticketTypes.map((t) => ({
    uid: `tt-${t.id}`,
    id: t.id,
    name: t.name,
    price: centsToEuroInput(t.priceCents),
    quota: String(t.quota),
    earlyPrice: centsToEuroInput(t.earlyPriceCents),
    earlyUntil: isoToZonedInput(t.earlyUntil, e.timezone),
    earlyQuota: t.earlyQuota === null ? '' : String(t.earlyQuota),
    sold: t.sold,
    held: t.held,
  })),
});

function ticketTypeError(t: TicketTypeDraft, startsAt: string | null, timezone: string): string | undefined {
  const label = t.name.trim() || 'Type sans nom';
  if (!t.name.trim()) return 'Nom obligatoire.';
  if (t.name.trim().length > FIELD_LIMITS.name) return `${label} : nom trop long.`;
  const price = parseEuros(t.price);
  if (price === null) return `${label} : prix invalide (ex. 12 ou 12,50).`;
  const quota = parseInteger(t.quota, t.sold + t.held, FIELD_LIMITS.quotaMax);
  if (quota === null) return `${label} : quota entre ${t.sold + t.held} et ${FIELD_LIMITS.quotaMax}.`;
  const hasEarly = t.earlyPrice.trim() !== '' || t.earlyUntil !== '';
  if (!hasEarly) return undefined;
  const earlyPrice = parseEuros(t.earlyPrice);
  if (earlyPrice === null || earlyPrice >= price) return `${label} : le prix early doit être inférieur au prix normal.`;
  const earlyUntil = zonedInputToIso(t.earlyUntil, timezone);
  if (!earlyUntil) return `${label} : date de fin du tarif early obligatoire.`;
  if (startsAt && earlyUntil > startsAt) return `${label} : le tarif early doit finir avant l’événement.`;
  if (t.earlyQuota.trim() && parseInteger(t.earlyQuota, 0, quota) === null) return `${label} : quota early entre 0 et ${quota}.`;
  return undefined;
}

export function validateEventForm(form: EventFormState, { requireFuture, now }: { requireFuture: boolean; now: Date }): EventFormErrors {
  const errors: EventFormErrors = {};
  const startsAt = zonedInputToIso(form.startsAt, form.timezone);
  if (!form.title.trim()) errors.title = 'Le titre est obligatoire.';
  else if (form.title.trim().length > FIELD_LIMITS.title) errors.title = `${FIELD_LIMITS.title} caractères maximum.`;
  if (form.isOnline && !safeExternalUrl(form.onlineUrl.trim())) errors.onlineUrl = 'Lien http(s) valide obligatoire.';
  if (!form.isOnline && !form.venue.trim()) errors.venue = 'Le lieu est obligatoire.';
  if (!startsAt) errors.startsAt = 'Date et heure obligatoires.';
  else if (requireFuture && new Date(startsAt) <= now) errors.startsAt = 'La date doit être dans le futur.';
  if (parseInteger(form.cancelDeadlineHours, 0, FIELD_LIMITS.cancelDeadlineHoursMax) === null) {
    errors.cancelDeadlineHours = `Entre 0 et ${FIELD_LIMITS.cancelDeadlineHoursMax} heures.`;
  }
  if (parseInteger(form.maxPerOrder, 1, FIELD_LIMITS.maxPerOrderMax) === null)
    errors.maxPerOrder = `Entre 1 et ${FIELD_LIMITS.maxPerOrderMax}.`;
  const typeErrors: Record<string, string> = {};
  for (const t of form.types) {
    const error = ticketTypeError(t, startsAt, form.timezone);
    if (error) typeErrors[t.uid] = error;
  }
  if (Object.keys(typeErrors).length > 0) errors.types = typeErrors;
  return errors;
}

export const hasEventFormErrors = (errors: EventFormErrors) => Object.keys(errors).length > 0;

// À appeler uniquement sur un formulaire validé.
export function toEventInput(form: EventFormState): EventInput {
  return {
    title: form.title.trim(),
    description: form.description.trim(),
    venue: form.venue.trim(),
    isOnline: form.isOnline,
    onlineUrl: form.onlineUrl.trim(),
    timezone: form.timezone,
    startsAt: zonedInputToIso(form.startsAt, form.timezone) ?? '',
    cancelDeadlineHours: Number(form.cancelDeadlineHours),
    maxPerOrder: Number(form.maxPerOrder),
    ticketTypes: form.types.map((t) => {
      const hasEarly = t.earlyPrice.trim() !== '';
      return {
        id: t.id,
        name: t.name.trim(),
        priceCents: parseEuros(t.price) ?? 0,
        quota: Number(t.quota),
        earlyPriceCents: hasEarly ? parseEuros(t.earlyPrice) : null,
        earlyUntil: hasEarly ? zonedInputToIso(t.earlyUntil, form.timezone) : null,
        earlyQuota: hasEarly && t.earlyQuota.trim() ? Number(t.earlyQuota) : null,
      };
    }),
  };
}
