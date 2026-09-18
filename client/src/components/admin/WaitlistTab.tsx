import { adminApi } from '../../api/admin';
import { useApiQuery } from '../../hooks/useApiQuery';
import { formatShort } from '../../utils/format';
import { QueryView } from '../common/QueryView';
import { WaitlistStatusBadge } from '../common/StatusBadge';

const REFRESH_MS = 10_000;

export function WaitlistTab({ eventId, timeZone }: { eventId: number; timeZone: string }) {
  const entries = useApiQuery(`waitlist:${eventId}`, (signal) => adminApi.waitlist(eventId, signal), { intervalMs: REFRESH_MS });
  return (
    <div className="stack">
      <p className="small muted">
        Quand une place se libère, elle est automatiquement proposée à la première personne en attente, qui a 2 h pour payer. Sans paiement,
        la place passe à la suivante.
      </p>
      <QueryView query={entries} empty="Personne en liste d’attente.">
        {(list) => (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th scope="col">Rang</th>
                  <th scope="col">Personne</th>
                  <th scope="col">Type</th>
                  <th scope="col" className="num">
                    Places
                  </th>
                  <th scope="col">Statut</th>
                  <th scope="col">Inscription</th>
                </tr>
              </thead>
              <tbody>
                {list.map((w, index) => (
                  <tr key={w.id}>
                    <td>{index + 1}</td>
                    <td>
                      {w.name}
                      <div className="small muted">{w.email}</div>
                    </td>
                    <td>{w.ticketTypeName}</td>
                    <td className="num">{w.quantity}</td>
                    <td>
                      <WaitlistStatusBadge status={w.status} />
                      {w.status === 'offered' && w.offerExpiresAt && (
                        <div className="small muted">jusqu’à {formatShort(w.offerExpiresAt, timeZone)}</div>
                      )}
                    </td>
                    <td className="small">{formatShort(w.createdAt, timeZone)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </QueryView>
    </div>
  );
}
