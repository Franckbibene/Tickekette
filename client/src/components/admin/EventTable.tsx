import { Link } from 'react-router-dom';
import type { AdminEventListItem } from '../../types/api';
import { formatMoney, formatShort } from '../../utils/format';
import { Meter } from '../common/Meter';
import { EventStatusBadge } from '../common/StatusBadge';

export function EventTable({ title, events }: { title: string; events: AdminEventListItem[] }) {
  return (
    <section className="stack">
      <h2>{title}</h2>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th scope="col">Événement</th>
              <th scope="col">Date</th>
              <th scope="col">Statut</th>
              <th scope="col">Remplissage</th>
              <th scope="col" className="num">
                Encaissé
              </th>
            </tr>
          </thead>
          <tbody>
            {events.map((e) => (
              <tr key={e.id}>
                <td>
                  <Link to={`/admin/evenements/${e.id}`} className="strong-link">
                    {e.title}
                  </Link>
                  <div className="small muted">{e.isOnline ? 'En ligne' : e.venue}</div>
                </td>
                <td className="nowrap">{formatShort(e.startsAt, e.timezone)}</td>
                <td>
                  <EventStatusBadge status={e.status} />
                </td>
                <td className="meter-cell">
                  <Meter sold={e.sold} held={e.held} quota={e.capacity} />
                  <div className="small muted">
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
