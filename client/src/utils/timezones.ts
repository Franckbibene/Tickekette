// Fuseaux horaires (5.10) : un événement est enregistré en UTC avec son fuseau (ex. Europe/Paris).
// On l'affiche à l'heure du lieu, et à l'heure du visiteur si elle est différente.

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
] as const;

export const DEFAULT_TIMEZONE = 'Europe/Paris';

export function userTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

export const cityOf = (timeZone: string) => (timeZone.split('/').pop() ?? timeZone).replace(/_/g, ' ');

// Décalage (ms) entre l'heure locale d'un fuseau et UTC à une date donnée.
function offsetMs(date: Date, timeZone: string): number {
  const parts: Record<string, number> = {};
  for (const p of new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(date)) {
    if (p.type !== 'literal') parts[p.type] = Number(p.value);
  }
  const asUtc = Date.UTC(parts.year ?? 0, (parts.month ?? 1) - 1, parts.day ?? 1, parts.hour ?? 0, parts.minute ?? 0, parts.second ?? 0);
  return asUtc - Math.floor(date.getTime() / 1000) * 1000;
}

export const sameClock = (iso: string, tzA: string, tzB: string) => offsetMs(new Date(iso), tzA) === offsetMs(new Date(iso), tzB);

const LOCAL_INPUT_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;

// « 2027-03-14T20:30 » saisi à l'heure de `timeZone` -> ISO UTC. Null si la saisie est invalide.
export function zonedInputToIso(local: string, timeZone: string): string | null {
  const match = LOCAL_INPUT_RE.exec(local);
  if (!match) return null;
  const [, y, mo, d, h, mi] = match.map(Number) as [number, number, number, number, number, number];
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  let ts = guess - offsetMs(new Date(guess), timeZone);
  ts = guess - offsetMs(new Date(ts), timeZone);
  return new Date(ts).toISOString();
}

// ISO UTC -> valeur pour <input type="datetime-local"> à l'heure de `timeZone`.
export function isoToZonedInput(iso: string | null, timeZone: string): string {
  if (!iso) return '';
  const date = new Date(iso);
  return new Date(date.getTime() + offsetMs(date, timeZone)).toISOString().slice(0, 16);
}
