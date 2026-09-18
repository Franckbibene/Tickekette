import { Link } from 'react-router-dom';
import { api, download } from '../../api.js';
import { ErrorMessage, Loading, StatusBadge, useResource } from '../../components/common.jsx';
import { formatMoney, formatShort } from '../../time.js';

export function Meter({ sold, held, quota, label }) {
  const pct = (n) => (quota > 0 ? `${(n / quota) * 100}%` : '0%');
  return (
    <div className="meter" role="img" aria-label={label ?? `${sold} vendues, ${held} réservées sur ${quota}`}>
      {sold > 0 && <div className="sold" style={{ width: pct(sold) }} />}
      {held > 0 && <div className="held" style={{ width: pct(held) }} />}
    </div>
  );
}

export default function AdminEvents() {
  const { data: events, error } = useResource(() => api('/admin/events'), [], { intervalMs: 10_000 });
  const now = new Date().toISOString();
  const upcoming = events?.filter((e) => e.startsAt >= now) ?? [];
  const past = events?.filter((e) => e.startsAt < now) ?? [];

  return (
    <div className="stack">
      <div className="spread">
        <h1 style={{ margin: 0 }}>Événements</h1>
        <div className="row">
          <button className="btn" onClick={() => download('/admin/accounting.csv', 'comptabilite.csv')}>
            ⬇ Export comptable
          </button>
          <Link to="/admin/evenements/nouveau" className="btn btn-primary">
            + Nouvel événement
          </Link>
        </div>
      </div>
      <ErrorMessage error={error} />
      {!events && !error && <Loading />}
      {events?.length === 0 && <p className="muted">Aucun événement. Créez le premier !</p>}
      {upcoming.length > 0 && <EventTable title="À venir" events={upcoming} />}
      {past.length > 0 && <EventTable title="Passés" events={past} />}
    </div>
  );
}

function EventTable({ title, events }) {
  return (
    <section className="stack">
      <h2>{title}</h2>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Événement</th>
              <th>Date</th>
              <th>Statut</th>
              <th>Remplissage</th>
              <th className="num">Encaissé</th>
            </tr>
          </thead>
          <tbody>
            {events.map((e) => (
              <tr key={e.id}>
                <td>
                  <Link to={`/admin/evenements/${e.id}`} style={{ fontWeight: 600 }}>
                    {e.title}
                  </Link>
                  <div className="small muted">{e.isOnline ? 'En ligne' : e.venue}</div>
                </td>
                <td style={{ whiteSpace: 'nowrap' }}>{formatShort(e.startsAt, e.timezone)}</td>
                <td>
                  <StatusBadge status={e.status} kind="event" />
                </td>
                <td style={{ minWidth: 150 }}>
                  <Meter sold={e.sold} held={e.held} quota={e.capacity} />
                  <div className="small muted" style={{ marginTop: 4 }}>
                    {e.sold} / {e.capacity} vendues{e.held > 0 && ` · ${e.held} réservées`}
                  </div>
                </td>
                <td className="num">{formatMoney(e.grossCents)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
