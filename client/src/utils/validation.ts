// Validation des formulaires côté navigateur : elle sert le CONFORT de l'utilisateur
// (erreurs affichées tout de suite). La sécurité repose sur la validation du serveur,
// qui refait toutes ces vérifications (server/src/validation.js).

export const FIELD_LIMITS = {
  name: 120,
  email: 254,
  title: 160,
  description: 4000,
  venue: 200,
  url: 500,
  passwordMin: 8,
  passwordMax: 72,
  priceEurosMax: 100_000,
  quotaMax: 100_000,
  maxPerOrderMax: 50,
  cancelDeadlineHoursMax: 24 * 60,
} as const;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type FieldErrors<K extends string> = Partial<Record<K, string>>;

export function validateName(value: string): string | undefined {
  const v = value.trim();
  if (!v) return 'Ce champ est obligatoire.';
  if (v.length > FIELD_LIMITS.name) return `${FIELD_LIMITS.name} caractères maximum.`;
  return undefined;
}

export function validateEmail(value: string): string | undefined {
  const v = value.trim();
  if (!v) return 'L’adresse e-mail est obligatoire.';
  if (v.length > FIELD_LIMITS.email || !EMAIL_RE.test(v)) return 'Adresse e-mail invalide.';
  return undefined;
}

export function validatePassword(value: string): string | undefined {
  if (value.length < FIELD_LIMITS.passwordMin) return `${FIELD_LIMITS.passwordMin} caractères minimum.`;
  if (new TextEncoder().encode(value).length > FIELD_LIMITS.passwordMax) return 'Mot de passe trop long.';
  return undefined;
}

// Montant en euros saisi (« 12 », « 12,50 ») -> centimes. Null si invalide.
export function parseEuros(value: string): number | null {
  const normalized = value.trim().replace(',', '.');
  if (!/^\d+(\.\d{1,2})?$/.test(normalized)) return null;
  const cents = Math.round(Number(normalized) * 100);
  return cents <= FIELD_LIMITS.priceEurosMax * 100 ? cents : null;
}

export function parseInteger(value: string, min: number, max: number): number | null {
  if (!/^\d+$/.test(value.trim())) return null;
  const n = Number(value);
  return Number.isSafeInteger(n) && n >= min && n <= max ? n : null;
}

// Nombre de places qu'on peut encore choisir pour un type, compte tenu du stock
// et du maximum par commande (les autres types déjà choisis comptent dans ce maximum).
export function maxSelectable(available: number, maxPerOrder: number, selectedElsewhere: number): number {
  return Math.max(0, Math.min(available, maxPerOrder - selectedElsewhere));
}

export const hasErrors = (errors: Record<string, string | undefined>) => Object.values(errors).some(Boolean);
