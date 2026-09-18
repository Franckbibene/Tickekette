import { Link } from 'react-router-dom';
import { adminApi } from '../../api/admin';
import { EventTable } from '../../components/admin/EventTable';
import { ErrorMessage } from '../../components/common/Feedback';
import { QueryView } from '../../components/common/QueryView';
import { useApiQuery } from '../../hooks/useApiQuery';
import { useAsyncAction } from '../../hooks/useAsyncAction';

const REFRESH_MS = 10_000;

export default function AdminEventsPage() {
  // L'heure de référence est prise au chargement des données (pas pendant le rendu).
  const events = useApiQuery(
    'admin:events',
    (signal) => adminApi.events(signal).then((list) => ({ list, loadedAt: new Date().toISOString() })),
    {
      intervalMs: REFRESH_MS,
    },
  );
  const accounting = useAsyncAction(() => adminApi.downloadAccounting());

  return (
    <div className="stack">
      <div className="spread">
        <h1 className="no-margin">Événements</h1>
        <div className="row">
          <button type="button" className="btn" disabled={accounting.pending} onClick={() => void accounting.run()}>
            Export comptable
          </button>
          <Link to="/admin/evenements/nouveau" className="btn btn-primary">
            + Nouvel événement
          </Link>
        </div>
      </div>
      <ErrorMessage error={accounting.error} />
      <QueryView query={events}>
        {({ list, loadedAt }) => {
          if (list.length === 0) return <p className="muted">Aucun événement. Créez le premier !</p>;
          const upcoming = list.filter((e) => e.startsAt >= loadedAt);
          const past = list.filter((e) => e.startsAt < loadedAt);
          return (
            <>
              {upcoming.length > 0 && <EventTable title="À venir" events={upcoming} />}
              {past.length > 0 && <EventTable title="Passés" events={past} />}
            </>
          );
        }}
      </QueryView>
    </div>
  );
}
