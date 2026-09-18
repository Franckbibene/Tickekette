// Fuseaux horaires (5.10) : un événement est enregistré en UTC avec son fuseau (ex. Europe/Paris).
// On l'affiche à l'heure du lieu, et à l'heure du visiteur si elle est différente.

const intlLocale = (lang) => (lang === 'en' ? 'en-GB' : 'fr-FR');

export function userTimeZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

export const formatDateTime = (iso, timeZone, lang = 'fr') =>
  new Intl.DateTimeFormat(intlLocale(lang), {
    timeZone,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso));

export const formatShort = (iso, timeZone, lang = 'fr') =>
  new Intl.DateTimeFormat(intlLocale(lang), {
    timeZone,
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso));

export const formatTime = (iso, timeZone, lang = 'fr') =>
  new Intl.DateTimeFormat(intlLocale(lang), { timeZone, hour: '2-digit', minute: '2-digit' }).format(new Date(iso));

export function dateParts(iso, timeZone, lang = 'fr') {
  const d = new Date(iso);
  const fmt = (opts) => new Intl.DateTimeFormat(intlLocale(lang), { timeZone, ...opts }).format(d);
  return { day: fmt({ day: 'numeric' }), month: fmt({ month: 'short' }).replace('.', ''), weekday: fmt({ weekday: 'short' }) };
}

export const cityOf = (timeZone) => timeZone.split('/').pop().replace(/_/g, ' ');

// Décalage (ms) entre l'heure locale d'un fuseau et UTC à une date donnée.
function offsetMs(date, timeZone) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
      .formatToParts(date)
      .map((p) => [p.type, p.value]),
  );
  const asUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
  return asUtc - Math.floor(date.getTime() / 1000) * 1000;
}

export const sameClock = (iso, tzA, tzB) => offsetMs(new Date(iso), tzA) === offsetMs(new Date(iso), tzB);

// « 2027-03-14T20:30 » saisi à l'heure de `timeZone` -> ISO UTC.
export function zonedInputToIso(local, timeZone) {
  if (!local) return null;
  const [d, t] = local.split('T');
  const [y, mo, da] = d.split('-').map(Number);
  const [h, mi] = t.split(':').map(Number);
  const guess = Date.UTC(y, mo - 1, da, h, mi);
  let ts = guess - offsetMs(new Date(guess), timeZone);
  ts = guess - offsetMs(new Date(ts), timeZone);
  return new Date(ts).toISOString();
}

// ISO UTC -> valeur pour <input type="datetime-local"> à l'heure de `timeZone`.
export function isoToZonedInput(iso, timeZone) {
  if (!iso) return '';
  const date = new Date(iso);
  return new Date(date.getTime() + offsetMs(date, timeZone)).toISOString().slice(0, 16);
}

export const formatMoney = (cents, lang = 'fr') =>
  new Intl.NumberFormat(intlLocale(lang), { style: 'currency', currency: 'EUR' }).format((cents ?? 0) / 100);

export const TIMEZONES = [
  'Europe/Paris',
  'Europe/London',
  'Europe/Lisbon',
  'Europe/Berlin',
  'Africa/Dakar',
  'Africa/Casablanca',
  'America/Montreal',
  'America/New_York',
  'America/Los_Angeles',
  'America/Sao_Paulo',
  'Asia/Tokyo',
  'Australia/Sydney',
  'UTC',
];
