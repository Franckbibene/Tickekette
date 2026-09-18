import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Html5Qrcode } from 'html5-qrcode';
import { api, storage } from '../../api.js';
import { formatTime } from '../../time.js';

// Contrôle à l'entrée (5.7).
// - En ligne : chaque scan est vérifié par le serveur (réponse définitive).
// - Hors ligne : décision prise sur la liste téléchargée avant l'ouverture des portes,
//   les entrées sont mises en file et synchronisées dès que le réseau revient.
// - Deux téléphones hors ligne peuvent valider le même billet : le conflit est signalé
//   à la synchronisation (ici et dans le tableau de bord de l'admin).

function deviceId() {
  let id = storage.get('tkk_device');
  if (!id) {
    id = `tel-${Math.random().toString(36).slice(2, 8)}`;
    storage.set('tkk_device', id);
  }
  return id;
}

const newScanId = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`);
const codeOf = (text) => {
  const value = String(text).trim();
  return value.startsWith('TKK1.') ? value.split('.')[1] ?? '' : value;
};

// État persistant dans le téléphone (survit à un rechargement de page sans réseau).
function usePersistent(key, initial) {
  const [value, setValue] = useState(() => storage.get(key, initial));
  const ref = useRef(value);
  const update = useCallback(
    (next) => {
      const v = typeof next === 'function' ? next(ref.current) : next;
      ref.current = v;
      storage.set(key, v);
      setValue(v);
    },
    [key],
  );
  return [value, update, ref];
}

export default function Scanner() {
  const { eventId } = useParams();
  const [manifest, setManifest, manifestRef] = usePersistent(`tkk_manifest_${eventId}`, null);
  const [queue, setQueue, queueRef] = usePersistent(`tkk_queue_${eventId}`, []);
  const [conflicts, setConflicts] = usePersistent(`tkk_conflicts_${eventId}`, []);
  const [settings, setSettings, settingsRef] = usePersistent('tkk_gate', { gate: 'Entrée principale', zone: [] });
  const [online, setOnline] = useState(navigator.onLine);
  const onlineRef = useRef(online);
  onlineRef.current = online;
  const [lastSync, setLastSync] = useState(null);
  const [result, setResult] = useState(null);
  const resultRef = useRef(null);
  resultRef.current = result;
  const [camera, setCamera] = useState(false);
  const [cameraError, setCameraError] = useState(null);
  const [search, setSearch] = useState('');
  const [loadError, setLoadError] = useState(null);
  const recent = useRef(new Map());

  const types = useMemo(() => new Map((manifest?.ticketTypes ?? []).map((t) => [t.id, t.name])), [manifest]);

  // ---------- Liste des billets ----------

  const downloadManifest = useCallback(async () => {
    setLoadError(null);
    try {
      const fresh = await api(`/scan/events/${eventId}/manifest`);
      // Les entrées validées localement mais pas encore synchronisées restent marquées.
      const pending = new Map(queueRef.current.map((s) => [s.code, s]));
      fresh.tickets = fresh.tickets.map((t) =>
        !t.enteredAt && pending.has(t.code) ? { ...t, enteredAt: pending.get(t.code).scannedAt, enteredGate: pending.get(t.code).gate } : t,
      );
      setManifest(fresh);
      setOnline(true);
    } catch (err) {
      setLoadError(err.message);
      if (err.status === 0) setOnline(false);
    }
  }, [eventId, setManifest, queueRef]);

  const markEntered = useCallback(
    (code, at, gate) =>
      setManifest((m) => m && { ...m, tickets: m.tickets.map((t) => (t.code === code && !t.enteredAt ? { ...t, enteredAt: at, enteredGate: gate } : t)) }),
    [setManifest],
  );

  // ---------- Synchronisation ----------

  const syncing = useRef(false);
  const sync = useCallback(async () => {
    if (syncing.current) return;
    syncing.current = true;
    const batch = queueRef.current;
    try {
      const res = await api(`/scan/events/${eventId}/sync`, {
        method: 'POST',
        timeoutMs: 8000,
        body: { deviceId: deviceId(), gate: settingsRef.current.gate, scans: batch },
      });
      const sent = new Set(batch.map((s) => s.clientScanId));
      setQueue((q) => q.filter((s) => !sent.has(s.clientScanId)));
      const newConflicts = res.results.filter((r) => r.result === 'duplicate');
      if (newConflicts.length) {
        setConflicts((c) => [
          ...newConflicts.map((r) => ({
            code: r.ticket?.code,
            holderName: r.ticket?.holderName,
            firstEntry: r.firstEntry,
            localAt: r.scannedAt,
          })),
          ...c,
        ]);
      }
      // Entrées validées aux autres portes : on les reporte dans la liste locale.
      const entries = new Map(res.entries.map((e) => [e.code, e]));
      setManifest((m) => m && { ...m, tickets: m.tickets.map((t) => (entries.has(t.code) ? { ...t, enteredAt: entries.get(t.code).enteredAt, enteredGate: entries.get(t.code).enteredGate } : t)) });
      setLastSync(res.syncedAt);
      setOnline(true);
    } catch (err) {
      if (err.status === 0) setOnline(false);
    } finally {
      syncing.current = false;
    }
  }, [eventId, queueRef, settingsRef, setQueue, setConflicts, setManifest]);

  useEffect(() => {
    if (!manifestRef.current) downloadManifest();
    const goOnline = () => {
      setOnline(true);
      sync();
    };
    const goOffline = () => setOnline(false);
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    const id = setInterval(sync, 15_000);
    sync();
    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
      clearInterval(id);
    };
  }, [downloadManifest, sync, manifestRef]);

  // ---------- Décision ----------

  const show = useCallback((r) => {
    setResult(r);
    if (navigator.vibrate) navigator.vibrate(r.tone === 'ok' ? 80 : [120, 60, 120]);
  }, []);

  useEffect(() => {
    if (!result) return undefined;
    const id = setTimeout(() => setResult(null), result.tone === 'ok' ? 1800 : 3500);
    return () => clearTimeout(id);
  }, [result]);

  const describeFirst = (entry) =>
    entry?.at ? `Déjà entré à ${formatTime(entry.at, manifestRef.current?.event.timezone ?? 'Europe/Paris')}${entry.gate ? ` (${entry.gate})` : ''}` : 'Déjà entré';

  const handle = useCallback(
    async (text) => {
      if (resultRef.current) return;
      const code = codeOf(text);
      if (!code) return;
      // Le même QR code reste souvent devant la caméra : on ignore les relectures immédiates.
      const last = recent.current.get(code);
      if (last && Date.now() - last < 3000) return;
      recent.current.set(code, Date.now());

      const m = manifestRef.current;
      const { gate, zone } = settingsRef.current;
      const local = m?.tickets.find((t) => t.code === code);

      if (local && zone.length > 0 && !zone.includes(local.ticketTypeId)) {
        show({ tone: 'warn', title: 'MAUVAISE ZONE', detail: `${local.holderName} — billet ${types.get(local.ticketTypeId)}` });
        return;
      }

      const clientScanId = newScanId();
      const scannedAt = new Date().toISOString();

      if (onlineRef.current) {
        try {
          const r = await api(`/scan/events/${eventId}/check`, {
            method: 'POST',
            timeoutMs: 4000,
            body: { text, deviceId: deviceId(), gate, clientScanId, scannedAt },
          });
          if (r.ticket && r.firstEntry) markEntered(r.ticket.code, r.firstEntry.at, r.firstEntry.gate);
          const who = r.ticket ? `${r.ticket.holderName} — ${r.ticket.ticketTypeName}` : '';
          if (r.result === 'ok') show({ tone: 'ok', title: 'VALIDE', detail: who });
          else if (r.result === 'duplicate') show({ tone: 'bad', title: 'DÉJÀ SCANNÉ', detail: `${who}\n${describeFirst(r.firstEntry)}` });
          else if (r.result === 'cancelled') show({ tone: 'bad', title: 'BILLET ANNULÉ', detail: `${who}\nCommande remboursée` });
          else if (r.result === 'wrong_event') show({ tone: 'bad', title: 'AUTRE ÉVÉNEMENT', detail: 'Ce billet n’est pas pour cet événement' });
          else show({ tone: 'bad', title: 'BILLET INCONNU', detail: 'QR code invalide ou falsifié' });
          return;
        } catch (err) {
          if (err.status !== 0) {
            show({ tone: 'bad', title: 'ERREUR', detail: err.message });
            return;
          }
          setOnline(false); // Réseau perdu : on bascule sur la liste locale.
        }
      }

      if (!m) {
        show({ tone: 'bad', title: 'LISTE ABSENTE', detail: 'Téléchargez la liste des billets avant de passer hors ligne.' });
        return;
      }
      const who = local ? `${local.holderName} — ${types.get(local.ticketTypeId)}` : '';
      if (!local) show({ tone: 'bad', title: 'BILLET INCONNU', detail: 'Absent de la liste téléchargée' });
      else if (local.status !== 'valid') show({ tone: 'bad', title: 'BILLET ANNULÉ', detail: who });
      else if (local.enteredAt) show({ tone: 'bad', title: 'DÉJÀ SCANNÉ', detail: `${who}\n${describeFirst({ at: local.enteredAt, gate: local.enteredGate })}` });
      else {
        markEntered(code, scannedAt, gate);
        setQueue((q) => [...q, { clientScanId, text, code, scannedAt, gate }]);
        show({ tone: 'ok', title: 'VALIDE', detail: `${who}\n(hors ligne, synchronisé plus tard)` });
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [eventId, markEntered, setQueue, show, types],
  );

  const handleRef = useRef(handle);
  handleRef.current = handle;

  // ---------- Caméra ----------

  useEffect(() => {
    if (!camera) return undefined;
    setCameraError(null);
    const reader = new Html5Qrcode('qr-reader', { verbose: false });
    let stopped = false;
    const started = reader
      .start({ facingMode: 'environment' }, { fps: 10, qrbox: { width: 240, height: 240 } }, (text) => handleRef.current(text), () => {})
      .catch((err) => {
        if (!stopped) setCameraError(`Caméra indisponible : ${err?.message ?? err}. Utilisez la saisie manuelle.`);
      });
    return () => {
      stopped = true;
      started.then(() => (reader.isScanning ? reader.stop() : null)).then(() => reader.clear()).catch(() => {});
    };
  }, [camera]);

  // ---------- Affichage ----------

  const validTickets = manifest?.tickets.filter((t) => t.status === 'valid') ?? [];
  const enteredCount = validTickets.filter((t) => t.enteredAt).length;
  const q = search.trim().toLowerCase();
  const matches =
    q.length >= 2
      ? (manifest?.tickets ?? [])
          .filter((t) => t.holderName.toLowerCase().includes(q) || t.reference.toLowerCase().includes(q) || t.code.toLowerCase().startsWith(q))
          .slice(0, 8)
      : [];

  return (
    <div className="scanner">
      <div className="scanner-top">
        <Link to="/controle" className="btn btn-small" aria-label="Retour à la liste des événements">
          ←
        </Link>
        <strong style={{ marginRight: 'auto', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {manifest?.event.title ?? 'Contrôle'}
        </strong>
        <span className={`net ${online ? 'on' : 'off'}`} role="status">
          {online ? '● En ligne' : '● Hors ligne'}
        </span>
      </div>

      <div className="container narrow stack" style={{ paddingTop: 16 }}>
        {loadError && !manifest && <div className="alert alert-error">{loadError}</div>}

        <div className="card card-tight spread">
          <div>
            <div style={{ fontSize: '2rem', fontWeight: 800, lineHeight: 1 }}>
              {enteredCount} <span className="muted" style={{ fontSize: '1rem' }}>/ {validTickets.length} entrés</span>
            </div>
            <div className="small muted">
              {manifest ? `Liste du ${formatTime(manifest.generatedAt, manifest.event.timezone)}` : 'Liste non téléchargée'}
              {lastSync && ` · synchro ${formatTime(lastSync, manifest?.event.timezone ?? 'Europe/Paris')}`}
            </div>
            {queue.length > 0 && (
              <div className="small" style={{ color: '#facc15' }}>
                {queue.length} entrée(s) à synchroniser
              </div>
            )}
          </div>
          <button className="btn btn-small" onClick={() => (online ? sync().then(downloadManifest) : downloadManifest())}>
            ↻ Actualiser
          </button>
        </div>

        {conflicts.length > 0 && (
          <div className="alert alert-error stack" style={{ color: '#1f1a17' }}>
            <strong>⚠️ {conflicts.length} billet(s) validé(s) à deux portes pendant la coupure réseau</strong>
            {conflicts.slice(0, 5).map((c, i) => (
              <div key={i} className="small">
                {c.holderName ?? c.code} — {describeFirst(c.firstEntry)}
              </div>
            ))}
            <button className="btn btn-small" style={{ background: '#fff', color: '#1f1a17' }} onClick={() => setConflicts([])}>
              Vu
            </button>
          </div>
        )}

        <div className="card stack">
          {camera ? (
            <>
              <div id="qr-reader" />
              {cameraError && <div className="alert alert-warn" style={{ color: '#1f1a17' }}>{cameraError}</div>}
              <button className="btn btn-block" onClick={() => setCamera(false)}>
                Arrêter la caméra
              </button>
            </>
          ) : (
            <button className="btn btn-primary btn-block btn-large" onClick={() => setCamera(true)}>
              📷 Scanner les QR codes
            </button>
          )}
        </div>

        <form
          className="card stack"
          onSubmit={(e) => {
            e.preventDefault();
            if (search.trim()) handle(search.trim());
            setSearch('');
          }}
        >
          <label className="field">
            <span>Saisie manuelle</span>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Nom, référence TKK-… ou code du billet"
              autoComplete="off"
              autoCapitalize="off"
            />
          </label>
          {matches.length > 0 && (
            <div className="search-results">
              {matches.map((t) => (
                <button
                  key={t.code}
                  type="button"
                  className="btn btn-small"
                  onClick={() => {
                    recent.current.delete(t.code);
                    handle(t.code);
                    setSearch('');
                  }}
                >
                  <span>
                    {t.holderName} · {types.get(t.ticketTypeId)}
                  </span>
                  <span className="small muted">{t.status !== 'valid' ? 'annulé' : t.enteredAt ? 'déjà entré' : t.reference}</span>
                </button>
              ))}
            </div>
          )}
        </form>

        <details className="card">
          <summary style={{ cursor: 'pointer', fontWeight: 600 }}>Réglages de ce téléphone</summary>
          <div className="stack" style={{ marginTop: 12 }}>
            <label className="field">
              <span>Nom de la porte</span>
              <input value={settings.gate} onChange={(e) => setSettings({ ...settings, gate: e.target.value })} />
            </label>
            <fieldset className="stack" style={{ border: 0, padding: 0, margin: 0 }}>
              <legend className="label">Zones acceptées à cette porte</legend>
              <p className="small muted">Aucune case cochée = tous les billets acceptés.</p>
              {(manifest?.ticketTypes ?? []).map((t) => (
                <label key={t.id} className="row">
                  <input
                    type="checkbox"
                    checked={settings.zone.includes(t.id)}
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        zone: e.target.checked ? [...settings.zone, t.id] : settings.zone.filter((z) => z !== t.id),
                      })
                    }
                  />
                  {t.name}
                </label>
              ))}
            </fieldset>
            <button className="btn" onClick={downloadManifest}>
              ⬇ Retélécharger la liste des billets
            </button>
            <p className="small muted">Identifiant du téléphone : {deviceId()}</p>
          </div>
        </details>
      </div>

      {result && (
        <div className={`scan-result ${result.tone}`} role="alert" onClick={() => setResult(null)}>
          <div className="icon" aria-hidden="true">
            {result.tone === 'ok' ? '✓' : result.tone === 'warn' ? '!' : '✕'}
          </div>
          <div className="big">{result.title}</div>
          <div style={{ whiteSpace: 'pre-line', fontSize: '1.2rem' }}>{result.detail}</div>
          <div className="small" style={{ opacity: 0.8, marginTop: 16 }}>
            Touchez pour continuer
          </div>
        </div>
      )}
    </div>
  );
}
