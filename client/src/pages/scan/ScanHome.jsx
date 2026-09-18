import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, storage } from '../../api.js';
import { useAuth } from '../../auth.jsx';
import { formatDateTime } from '../../time.js';

export default function ScanHome() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  // Liste gardée en local : elle reste consultable sans réseau.
  const [events, setEvents] = useState(() => storage.get('tkk_scan_events', null));
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    api('/scan/events')
      .then((list) => {
        storage.set('tkk_scan_events', list);
        setEvents(list);
        setOffline(false);
      })
      .catch((err) => {
        if (err.status === 0) setOffline(true);
      });
  }, []);

  return (
    <div className="scanner">
      <div className="scanner-top">
        <strong style={{ marginRight: 'auto' }}>📷 Contrôle à l’entrée</strong>
        {user.role === 'admin' && (
          <Link to="/admin" className="btn btn-small">
            Espace admin
          </Link>
        )}
        <button
          className="btn btn-small"
          onClick={() => {
            logout();
            navigate('/connexion');
          }}
        >
          Déconnexion
        </button>
      </div>
      <div className="container narrow stack" style={{ paddingTop: 16 }}>
        <p className="muted">
          {user.name} · {user.collective?.name}
        </p>
        {offline && <div className="alert alert-warn">Hors ligne : liste enregistrée lors de la dernière connexion.</div>}
        {events?.length === 0 && <p className="muted">Aucun événement à contrôler.</p>}
        {events?.map((e) => {
          const ready = Boolean(storage.get(`tkk_manifest_${e.id}`));
          return (
            <Link key={e.id} to={`/controle/${e.id}`} className="card" style={{ display: 'block', textDecoration: 'none' }}>
              <strong>{e.title}</strong>
              <div className="small muted">{formatDateTime(e.startsAt, e.timezone)}</div>
              <div className="small muted">{e.isOnline ? 'En ligne' : e.venue}</div>
              <div style={{ marginTop: 8 }}>
                {ready ? (
                  <span className="badge badge-good">Liste téléchargée, prêt hors ligne</span>
                ) : (
                  <span className="badge badge-warn">Liste à télécharger</span>
                )}
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
