// Sécurité des liens et redirections.

// Redirection interne uniquement : un chemin « /quelque-chose » de notre site.
// Refuse « //site.com », « /\site.com » et toute URL absolue (open redirect).
export function safeInternalPath(value: unknown, fallback = '/'): string {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//') || value.startsWith('/\\')) {
    return fallback;
  }
  return value;
}

// Lien externe affiché dans la page : http(s) uniquement (pas de javascript:, data:…).
export function safeExternalUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : null;
  } catch {
    return null;
  }
}

// Identifiant numérique issu de l'URL (/evenements/:id). Null s'il est mal formé.
export function parseRouteId(value: string | undefined): number | null {
  if (!value || !/^\d{1,10}$/.test(value)) return null;
  const id = Number(value);
  return id > 0 ? id : null;
}
