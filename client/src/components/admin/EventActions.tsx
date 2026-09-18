import { Link } from 'react-router-dom';
import { adminApi } from '../../api/admin';
import { useAsyncAction } from '../../hooks/useAsyncAction';
import type { AdminEvent } from '../../types/api';
import { ErrorMessage } from '../common/Feedback';

const CANCEL_CONFIRMATION =
  'Annuler l’événement ? Toutes les commandes payées seront remboursées et les participants prévenus par mail. Cette action est définitive.';

export function EventActions({ event, onChanged }: { event: AdminEvent; onChanged: (event: AdminEvent) => void }) {
  const exportParticipants = useAsyncAction(() => adminApi.downloadParticipants(event.id));
  const cancel = useAsyncAction(async () => onChanged(await adminApi.cancelEvent(event.id)));

  return (
    <section className="card stack">
      <h2>Exports et actions</h2>
      <div className="row">
        <button type="button" className="btn" disabled={exportParticipants.pending} onClick={() => void exportParticipants.run()}>
          Liste des participants (Excel / CSV)
        </button>
        {event.status === 'published' && (
          <Link className="btn" to={`/controle/${event.id}`}>
            Ouvrir le contrôle à l’entrée
          </Link>
        )}
      </div>
      <ErrorMessage error={exportParticipants.error ?? cancel.error} />
      {event.status !== 'cancelled' && (
        <div>
          <button
            type="button"
            className="btn btn-danger"
            disabled={cancel.pending}
            onClick={() => {
              if (window.confirm(CANCEL_CONFIRMATION)) void cancel.run();
            }}
          >
            Annuler l’événement et rembourser tout le monde
          </button>
        </div>
      )}
    </section>
  );
}
