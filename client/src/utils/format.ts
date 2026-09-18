import type { Lang } from '../i18n/dictionaries';

const intlLocale = (lang: Lang) => (lang === 'en' ? 'en-GB' : 'fr-FR');

export const formatMoney = (cents: number, lang: Lang = 'fr') =>
  new Intl.NumberFormat(intlLocale(lang), { style: 'currency', currency: 'EUR' }).format(cents / 100);

const dateFormatter = (lang: Lang, timeZone: string, options: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat(intlLocale(lang), { timeZone, ...options });

export const formatDateTime = (iso: string, timeZone: string, lang: Lang = 'fr') =>
  dateFormatter(lang, timeZone, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso));

export const formatShort = (iso: string, timeZone: string, lang: Lang = 'fr') =>
  dateFormatter(lang, timeZone, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(iso));

export const formatTime = (iso: string, timeZone: string, lang: Lang = 'fr') =>
  dateFormatter(lang, timeZone, { hour: '2-digit', minute: '2-digit' }).format(new Date(iso));

export function dateParts(iso: string, timeZone: string, lang: Lang = 'fr') {
  const date = new Date(iso);
  const part = (options: Intl.DateTimeFormatOptions) => dateFormatter(lang, timeZone, options).format(date);
  return { day: part({ day: 'numeric' }), month: part({ month: 'short' }).replace('.', ''), weekday: part({ weekday: 'short' }) };
}

// « 3:05 » pour un compte à rebours court, « 47 h 05 » au-delà d'une heure.
export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return hours > 0 ? `${hours} h ${pad(minutes)}` : `${pad(minutes)}:${pad(seconds)}`;
}

export const centsToEuroInput = (cents: number | null) => (cents === null ? '' : String(cents / 100));
