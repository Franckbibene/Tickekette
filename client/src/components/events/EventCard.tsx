import { Link } from 'react-router-dom';
import { useLang } from '../../hooks/useLang';
import type { EventSummary } from '../../types/api';
import { dateParts, formatMoney, formatTime } from '../../utils/format';
import { cityOf } from '../../utils/timezones';

export function EventCard({ event }: { event: EventSummary }) {
  const { t, lang } = useLang();
  const d = dateParts(event.startsAt, event.timezone, lang);
  return (
    <li>
      <Link to={`/evenements/${event.id}`} className="card event-card">
        <div className="date-block" aria-hidden="true">
          <span className="w">{d.weekday}</span>
          <span className="d">{d.day}</span>
          <span className="m">{d.month}</span>
        </div>
        <div className="event-card-body">
          <div className="row small muted">
            <span className="collective-dot" style={{ background: event.collective.color }} />
            {event.collective.name}
          </div>
          <h3>{event.title}</h3>
          <p className="small muted">
            <time dateTime={event.startsAt}>{formatTime(event.startsAt, event.timezone, lang)}</time> ({cityOf(event.timezone)}) ·{' '}
            {event.isOnline ? t('list.online') : event.venue}
          </p>
          <div className="row">
            {event.soldOut ? (
              <span className="badge badge-bad">{t('list.soldOut')}</span>
            ) : (
              event.fromPriceCents !== null && (
                <span className="badge badge-accent">{t('list.from', { price: formatMoney(event.fromPriceCents, lang) })}</span>
              )
            )}
            {event.isOnline && <span className="badge badge-info">{t('list.online')}</span>}
          </div>
        </div>
      </Link>
    </li>
  );
}
