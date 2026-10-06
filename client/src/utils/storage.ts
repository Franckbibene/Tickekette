// Stockage local du navigateur, uniquement pour des données NON secrètes :
// préférences (langue), profil affiché (nom, rôle) et données hors ligne du contrôle.
// La session, elle, est dans un cookie HttpOnly que le JavaScript ne peut pas lire.
// localStorage peut être indisponible (navigation privée) : on ne plante jamais dessus.

export const STORAGE_KEYS = {
  lang: 'tkk_lang',
  user: 'tkk_user',
  device: 'tkk_device',
  scanEvents: 'tkk_scan_events',
  gate: 'tkk_gate',
  manifest: (eventId: number) => `tkk_manifest_${eventId}`,
  queue: (eventId: number) => `tkk_queue_${eventId}`,
  conflicts: (eventId: number) => `tkk_conflicts_${eventId}`,
  logoutPending: 'tkk_logout_pending',
} as const;

const OFFLINE_PREFIXES = ['tkk_manifest_', 'tkk_queue_', 'tkk_conflicts_', STORAGE_KEYS.scanEvents];

export const storage = {
  get<T>(key: string, fallback: T): T {
    try {
      const raw = localStorage.getItem(key);
      return raw === null ? fallback : (JSON.parse(raw) as T);
    } catch {
      return fallback;
    }
  },
  set(key: string, value: unknown): void {
    try {
      if (value === null || value === undefined) localStorage.removeItem(key);
      else localStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* stockage indisponible ou plein : l'application continue sans persistance */
    }
  },
};

// À la déconnexion : on efface toutes les données de contrôle, y compris les scans en
// attente. Les conserver permettrait à un autre utilisateur du téléphone de les lire.
export function clearOfflineData(): void {
  try {
    for (const key of Object.keys(localStorage)) {
      if (OFFLINE_PREFIXES.some((prefix) => key.startsWith(prefix))) localStorage.removeItem(key);
    }
    localStorage.removeItem(STORAGE_KEYS.user);
  } catch {
    /* stockage indisponible */
  }
}

export const hasOfflineManifest = (eventId: number): boolean => storage.get<unknown>(STORAGE_KEYS.manifest(eventId), null) !== null;

export function getDeviceId(): string {
  const existing = storage.get<string | null>(STORAGE_KEYS.device, null);
  if (existing) return existing;
  const id = `tel-${crypto.randomUUID().slice(0, 8)}`;
  storage.set(STORAGE_KEYS.device, id);
  return id;
}
