// Client HTTP unique de l'application : tous les appels à l'API passent par ici.
// - Session : cookie HttpOnly envoyé automatiquement (aucun jeton manipulé en JavaScript).
// - CSRF : en-tête personnalisé exigé par le serveur sur les requêtes qui modifient des données.
// - Délai maximal, annulation (AbortSignal), messages d'erreur normalisés.
// - Une réponse n'est jamais supposée correcte : statut HTTP et format sont vérifiés.

const API_PREFIX = '/api';
const DEFAULT_TIMEOUT_MS = 15_000;
const CSRF_HEADERS = { 'X-Requested-With': 'tickekette' };
const MAX_SERVER_MESSAGE_LENGTH = 300;

// Émis quand le serveur répond 401 : la session a expiré, l'interface se déconnecte.
export const UNAUTHORIZED_EVENT = 'tkk:unauthorized';

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: Record<string, unknown>;

  constructor(status: number, code: string, message: string, details: Record<string, unknown> = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }

  get isNetworkError(): boolean {
    return this.status === 0;
  }
}

const GENERIC_MESSAGES: Record<number, string> = {
  400: 'Certaines informations sont invalides.',
  401: 'Votre session a expiré, reconnectez-vous.',
  403: 'Vous n’avez pas accès à cette action.',
  404: 'Élément introuvable.',
  409: 'Cette action n’est plus possible.',
  413: 'Envoi trop volumineux.',
  429: 'Trop de tentatives, réessayez dans quelques minutes.',
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// Seuls les messages prévus par l'API sont affichés ; sinon un message générique.
function userMessage(status: number, body: unknown): string {
  if (isRecord(body) && typeof body.message === 'string' && body.message.length <= MAX_SERVER_MESSAGE_LENGTH) {
    return body.message;
  }
  return GENERIC_MESSAGES[status] ?? 'Le service est momentanément indisponible, réessayez.';
}

export const isAbortError = (err: unknown): boolean => err instanceof DOMException && err.name === 'AbortError';

export function toApiError(err: unknown): ApiError {
  if (err instanceof ApiError) return err;
  if (import.meta.env.DEV) console.error(err);
  return new ApiError(0, 'unexpected', 'Une erreur inattendue est survenue.');
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  body?: unknown;
  signal?: AbortSignal;
  timeoutMs?: number;
  headers?: Record<string, string>;
}

async function send(path: string, { method = 'GET', body, signal, timeoutMs = DEFAULT_TIMEOUT_MS, headers = {} }: RequestOptions) {
  const timeout = AbortSignal.timeout(timeoutMs);
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
  try {
    return await fetch(`${API_PREFIX}${path}`, {
      method,
      credentials: 'same-origin',
      signal: combined,
      headers: {
        Accept: 'application/json',
        ...CSRF_HEADERS,
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...headers,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch (err) {
    // Annulation voulue par l'appelant (composant démonté…) : on la laisse remonter telle quelle.
    if (signal?.aborted) throw err;
    if (timeout.aborted) throw new ApiError(0, 'timeout', 'Le serveur met trop de temps à répondre. Vérifiez votre connexion.');
    throw new ApiError(0, 'network', 'Connexion impossible. Vérifiez votre réseau.');
  }
}

async function readJson(res: Response): Promise<unknown> {
  if (!(res.headers.get('content-type') ?? '').includes('application/json')) return undefined;
  try {
    return await res.json();
  } catch {
    return undefined;
  }
}

export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const res = await send(path, options);
  if (res.status === 204) return undefined as T;
  const body = await readJson(res);
  if (!res.ok) {
    if (res.status === 401) window.dispatchEvent(new Event(UNAUTHORIZED_EVENT));
    const code = isRecord(body) && typeof body.error === 'string' ? body.error : 'http_error';
    throw new ApiError(res.status, code, userMessage(res.status, body), isRecord(body) ? body : {});
  }
  if (body === undefined) throw new ApiError(res.status, 'invalid_response', 'Réponse inattendue du serveur.');
  return body as T;
}

// Vérifications minimales de structure sur les réponses (le typage TypeScript n'existe plus à l'exécution).
export function expectObject<T>(value: T, requiredKeys: (keyof T & string)[]): T {
  if (!isRecord(value) || requiredKeys.some((k) => !(k in value))) {
    throw new ApiError(200, 'invalid_response', 'Réponse inattendue du serveur.');
  }
  return value;
}

export function expectArray<T>(value: T[]): T[] {
  if (!Array.isArray(value)) throw new ApiError(200, 'invalid_response', 'Réponse inattendue du serveur.');
  return value;
}

// Téléchargement d'un fichier (export CSV) avec la session courante.
export async function download(path: string, fallbackName: string): Promise<void> {
  const res = await send(path, {});
  if (!res.ok) throw new ApiError(res.status, 'download_failed', userMessage(res.status, await readJson(res)));
  const name = /filename="([\w.-]+)"/.exec(res.headers.get('content-disposition') ?? '')?.[1] ?? fallbackName;
  const url = URL.createObjectURL(await res.blob());
  const link = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
