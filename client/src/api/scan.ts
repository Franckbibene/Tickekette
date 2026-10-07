import type { Manifest, PendingScan, ScanEvent, ScanResponse, SyncResponse } from '../types/api';
import { expectArray, expectObject, request } from './http';

const CHECK_TIMEOUT_MS = 4000;
const SYNC_TIMEOUT_MS = 8000;

export const scanApi = {
  events: (signal?: AbortSignal) => request<ScanEvent[]>('/scan/events', { signal }).then(expectArray),
  manifest: (eventId: number) =>
    request<Manifest>(`/scan/events/${eventId}/manifest`).then((m) =>
      expectObject(m, ['event', 'ticketTypes', 'tickets', 'offlineGrant', 'offlineExpiresAt']),
    ),
  // Délai court : sans réponse rapide, le téléphone bascule sur la liste hors ligne.
  check: (eventId: number, scan: PendingScan & { deviceId: string }) =>
    request<ScanResponse>(`/scan/events/${eventId}/check`, { method: 'POST', body: scan, timeoutMs: CHECK_TIMEOUT_MS }).then((r) =>
      expectObject(r, ['result']),
    ),
  sync: (eventId: number, body: { deviceId: string; gate: string; scans: PendingScan[]; offlineGrant: string }) =>
    request<SyncResponse>(`/scan/events/${eventId}/sync`, { method: 'POST', body, timeoutMs: SYNC_TIMEOUT_MS }).then((r) =>
      expectObject(r, ['results', 'entries', 'syncedAt']),
    ),
};
