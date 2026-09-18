import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { scanApi } from '../../api/scan';
import { useApiQuery } from '../../hooks/useApiQuery';
import { useAsyncAction } from '../../hooks/useAsyncAction';
import { useAuth } from '../../hooks/useAuth';
import type { ScanEvent } from '../../types/api';
import { formatDateTime } from '../../utils/format';
import { STORAGE_KEYS, hasOfflineManifest, storage } from '../../utils/storage';

// Liste des événements à contrôler. Elle est gardée sur le téléphone pour rester consultable hors ligne.
export default function ScanHomePage() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [cached] = useState(() => storage.get<ScanEvent[] | null>(STORAGE_KEYS.scanEvents, null));
  const query = useApiQuery('scan:events', (signal) =>
    scanApi.events(signal).then((list) => {
      storage.set(STORAGE_KEYS.scanEvents, list);
      return list;
    }),
  );
  const signOut = useAsyncAction(async () => {
    await logout();
    void navigate('/connexion', { replace: true });
  });
  const events = query.data ?? cached;
  const offline = query.error?.isNetworkError ?? false;

  return (
    <div className="scanner">
      <header className="scanner-top">
        <h1 className="scanner-title">Contrôle à l’entrée</h1>
        {user?.role === 'admin' && (
          <Link to="/admin" className="btn btn-small">
            Espace admin
          </Link>
        )}
        <button type="button" className="btn btn-small" disabled={signOut.pending} onClick={() => void signOut.run()}>
          Déconnexion
        </button>
      </header>
      <main className="container narrow stack scanner-main">
        <p className="muted">
          {user?.name} · {user?.collective?.name}
        </p>
        {offline && <div className="alert alert-warn">Hors ligne : liste enregistrée lors de la dernière connexion.</div>}
        {query.error && !offline && <div className="alert alert-error">{query.error.message}</div>}
        {!events && !query.error && <p className="muted">Chargement…</p>}
        {events?.length === 0 && <p className="muted">Aucun événement à contrôler.</p>}
        <ul className="plain-list stack">
          {events?.map((e) => (
            <li key={e.id}>
              <Link to={`/controle/${e.id}`} className="card block-link">
                <strong>{e.title}</strong>
                <div className="small muted">{formatDateTime(e.startsAt, e.timezone)}</div>
                <div className="small muted">{e.isOnline ? 'En ligne' : e.venue}</div>
                <div className="badge-row">
                  {hasOfflineManifest(e.id) ? (
                    <span className="badge badge-good">Liste téléchargée, prêt hors ligne</span>
                  ) : (
                    <span className="badge badge-warn">Liste à télécharger</span>
                  )}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      </main>
    </div>
  );
}
