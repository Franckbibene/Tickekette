import { useEffect, useEffectEvent, useRef, useState } from 'react';
import { ApiError, toApiError } from '../api/http';
import { scanApi } from '../api/scan';
import type { Manifest, PendingScan, ScanResponse } from '../types/api';
import { formatTime } from '../utils/format';
import { applyEntries, decideOffline, extractTicketCode, markEntered, type OfflineDecision } from '../utils/scanDecision';
import { STORAGE_KEYS, getDeviceId } from '../utils/storage';
import { DEFAULT_TIMEZONE } from '../utils/timezones';
import { usePersistentState } from './usePersistentState';

const SYNC_INTERVAL_MS = 15_000;
const REPEAT_IGNORE_MS = 3000;
const FEEDBACK_OK_MS = 1800;
const FEEDBACK_ERROR_MS = 3500;

export type FeedbackTone = 'ok' | 'bad' | 'warn';

export interface ScanFeedback {
  tone: FeedbackTone;
  title: string;
  detail: string;
}

export interface GateSettings {
  gate: string;
  // Types de place acceptés à cette porte (vide = tous).
  zone: number[];
}

export interface SyncConflict {
  id: string;
  holderName: string | null;
  firstEntry: { at: string; gate: string | null } | null;
}

const DEFAULT_GATE: GateSettings = { gate: 'Entrée principale', zone: [] };

// Contrôle à l'entrée (5.7).
// - En ligne : chaque scan est vérifié par le serveur (réponse définitive).
// - Hors ligne : décision prise sur la liste téléchargée avant l'ouverture des portes ;
//   les entrées sont mises en file et synchronisées dès que le réseau revient.
// - Deux téléphones hors ligne peuvent valider le même billet : le conflit est signalé
//   à la synchronisation (ici et dans le tableau de bord de l'admin).
export function useOfflineScanner(eventId: number) {
  const [manifest, setManifest] = usePersistentState<Manifest | null>(STORAGE_KEYS.manifest(eventId), null);
  const [queue, setQueue] = usePersistentState<PendingScan[]>(STORAGE_KEYS.queue(eventId), []);
  const [conflicts, setConflicts] = usePersistentState<SyncConflict[]>(STORAGE_KEYS.conflicts(eventId), []);
  const [settings, setSettings] = usePersistentState<GateSettings>(STORAGE_KEYS.gate, DEFAULT_GATE);
  const [online, setOnline] = useState(() => navigator.onLine);
  const [lastSync, setLastSync] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<ScanFeedback | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [deviceId] = useState(getDeviceId);
  const syncing = useRef(false);
  const recentCodes = useRef(new Map<string, number>());

  const timeZone = manifest?.event.timezone ?? DEFAULT_TIMEZONE;
  const typeName = (id: number) => manifest?.ticketTypes.find((t) => t.id === id)?.name ?? '';
  const describeFirst = (entry: { at: string; gate: string | null } | null) =>
    entry ? `Déjà entré à ${formatTime(entry.at, timeZone)}${entry.gate ? ` (${entry.gate})` : ''}` : 'Déjà entré';

  function show(next: ScanFeedback) {
    setFeedback(next);
    // Vibration absente sur certains navigateurs (Safari iOS) malgré ce qu'indiquent les types.
    if ('vibrate' in navigator) navigator.vibrate(next.tone === 'ok' ? 80 : [120, 60, 120]);
  }

  function handleNetworkError(err: unknown) {
    if (err instanceof ApiError && err.isNetworkError) setOnline(false);
  }

  async function downloadManifest() {
    try {
      const fresh = await scanApi.manifest(eventId);
      setLoadError(null);
      // Les entrées validées ici mais pas encore synchronisées restent marquées.
      const withPending = queue.reduce((m, s) => markEntered(m, s.code, s.scannedAt, s.gate), fresh);
      setManifest(withPending);
      setOnline(true);
    } catch (err) {
      setLoadError(toApiError(err).message);
      handleNetworkError(err);
    }
  }

  async function sync() {
    if (syncing.current) return;
    syncing.current = true;
    const batch = queue;
    try {
      const res = await scanApi.sync(eventId, { deviceId, gate: settings.gate, scans: batch });
      const sent = new Set(batch.map((s) => s.clientScanId));
      setQueue((q) => q.filter((s) => !sent.has(s.clientScanId)));
      const newConflicts = res.results
        .filter((r) => r.result === 'duplicate')
        .map((r) => ({ id: r.clientScanId, holderName: r.ticket?.holderName ?? null, firstEntry: r.firstEntry }));
      if (newConflicts.length > 0) setConflicts((c) => [...newConflicts, ...c]);
      setManifest((m) => (m ? applyEntries(m, res.entries) : m));
      setLastSync(res.syncedAt);
      setOnline(true);
    } catch (err) {
      handleNetworkError(err);
    } finally {
      syncing.current = false;
    }
  }

  function showServerResult(r: ScanResponse) {
    if (r.ticket && r.firstEntry) {
      const { code } = r.ticket;
      const { at, gate } = r.firstEntry;
      setManifest((m) => (m ? markEntered(m, code, at, gate) : m));
    }
    const who = r.ticket ? `${r.ticket.holderName} — ${r.ticket.ticketTypeName}` : '';
    const messages: Record<ScanResponse['result'], ScanFeedback> = {
      ok: { tone: 'ok', title: 'VALIDE', detail: who },
      duplicate: { tone: 'bad', title: 'DÉJÀ SCANNÉ', detail: `${who}\n${describeFirst(r.firstEntry)}` },
      cancelled: { tone: 'bad', title: 'BILLET ANNULÉ', detail: `${who}\nCommande remboursée` },
      wrong_event: { tone: 'bad', title: 'AUTRE ÉVÉNEMENT', detail: 'Ce billet n’est pas pour cet événement' },
      invalid: { tone: 'bad', title: 'BILLET INCONNU', detail: 'QR code invalide ou falsifié' },
    };
    show(messages[r.result]);
  }

  function decideLocally(text: string, code: string, scan: PendingScan) {
    const decision = decideOffline(manifest, code, settings.zone);
    if (decision.kind === 'ok') {
      setManifest((m) => (m ? markEntered(m, code, scan.scannedAt, scan.gate) : m));
      setQueue((q) => [...q, { ...scan, text }]);
    }
    show(offlineFeedback(decision));
  }

  function offlineFeedback(decision: OfflineDecision): ScanFeedback {
    switch (decision.kind) {
      case 'no_manifest':
        return { tone: 'bad', title: 'LISTE ABSENTE', detail: 'Téléchargez la liste des billets avant de passer hors ligne.' };
      case 'unknown':
        return { tone: 'bad', title: 'BILLET INCONNU', detail: 'Absent de la liste téléchargée' };
      case 'wrong_zone':
        return {
          tone: 'warn',
          title: 'MAUVAISE ZONE',
          detail: `${decision.ticket.holderName} — billet ${typeName(decision.ticket.ticketTypeId)}`,
        };
      case 'cancelled':
        return { tone: 'bad', title: 'BILLET ANNULÉ', detail: decision.ticket.holderName };
      case 'duplicate': {
        const { holderName, enteredAt, enteredGate } = decision.ticket;
        return {
          tone: 'bad',
          title: 'DÉJÀ SCANNÉ',
          detail: `${holderName}\n${describeFirst(enteredAt ? { at: enteredAt, gate: enteredGate } : null)}`,
        };
      }
      case 'ok':
        return {
          tone: 'ok',
          title: 'VALIDE',
          detail: `${decision.ticket.holderName} — ${typeName(decision.ticket.ticketTypeId)}\n(hors ligne, synchronisé plus tard)`,
        };
    }
  }

  async function handleScan(text: string) {
    if (feedback) return;
    const code = extractTicketCode(text);
    if (!code) return;
    // Le même QR code reste souvent devant la caméra : on ignore les relectures immédiates.
    const lastSeen = recentCodes.current.get(code);
    if (lastSeen !== undefined && Date.now() - lastSeen < REPEAT_IGNORE_MS) return;
    recentCodes.current.set(code, Date.now());

    // La zone se vérifie avant tout enregistrement : un billet de la mauvaise zone n'est pas consommé.
    const local = manifest?.tickets.find((t) => t.code === code);
    if (local && settings.zone.length > 0 && !settings.zone.includes(local.ticketTypeId)) {
      show({ tone: 'warn', title: 'MAUVAISE ZONE', detail: `${local.holderName} — billet ${typeName(local.ticketTypeId)}` });
      return;
    }

    const scan: PendingScan = { clientScanId: crypto.randomUUID(), text, code, scannedAt: new Date().toISOString(), gate: settings.gate };
    if (online) {
      try {
        showServerResult(await scanApi.check(eventId, { ...scan, deviceId }));
        return;
      } catch (err) {
        if (!(err instanceof ApiError && err.isNetworkError)) {
          show({ tone: 'bad', title: 'ERREUR', detail: toApiError(err).message });
          return;
        }
        setOnline(false); // Réseau perdu : on bascule sur la liste locale.
      }
    }
    decideLocally(text, code, scan);
  }

  // Scan manuel depuis la recherche : on autorise à revalider le même billet immédiatement.
  function handleManual(code: string) {
    recentCodes.current.delete(code);
    void handleScan(code);
  }

  const onTick = useEffectEvent(() => {
    void sync();
  });
  const onMount = useEffectEvent(() => {
    if (!manifest) void downloadManifest();
    void sync();
  });

  // Démarrage (liste des billets + première synchro) puis synchro périodique et au retour du réseau.
  useEffect(() => {
    const start = window.setTimeout(onMount, 0);
    const goOnline = () => {
      setOnline(true);
      onTick();
    };
    const goOffline = () => setOnline(false);
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    const timer = window.setInterval(onTick, SYNC_INTERVAL_MS);
    return () => {
      window.clearTimeout(start);
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    if (!feedback) return undefined;
    const timer = window.setTimeout(() => setFeedback(null), feedback.tone === 'ok' ? FEEDBACK_OK_MS : FEEDBACK_ERROR_MS);
    return () => window.clearTimeout(timer);
  }, [feedback]);

  return {
    manifest,
    pendingCount: queue.length,
    conflicts,
    clearConflicts: () => setConflicts([]),
    settings,
    setSettings,
    online,
    lastSync,
    feedback,
    dismissFeedback: () => setFeedback(null),
    loadError,
    deviceId,
    timeZone,
    typeName,
    describeFirst,
    handleScan,
    handleManual,
    refresh: async () => {
      if (online) await sync();
      await downloadManifest();
    },
    downloadManifest,
  };
}
