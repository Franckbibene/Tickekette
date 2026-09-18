import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { eventsApi } from '../../api/events';
import { ErrorMessage, Loading } from '../../components/common/Feedback';
import { EventTime } from '../../components/common/EventTime';
import { CheckoutForm } from '../../components/events/CheckoutForm';
import { TicketTypeRow } from '../../components/events/TicketTypeRow';
import { useApiQuery } from '../../hooks/useApiQuery';
import { useLang } from '../../hooks/useLang';
import type { EventDetail } from '../../types/api';
import { clampSelection, selectionTotal } from '../../utils/pricing';
import { parseRouteId } from '../../utils/url';
import { maxSelectable } from '../../utils/validation';
import NotFoundPage from './NotFoundPage';

export default function EventPage() {
  const eventId = parseRouteId(useParams().id);
  if (eventId === null) return <NotFoundPage />;
  return <EventScreen key={eventId} eventId={eventId} />;
}

function EventScreen({ eventId }: { eventId: number }) {
  const { t } = useLang();
  const query = useApiQuery(`event:${eventId}`, (signal) => eventsApi.get(eventId, signal));

  if (!query.data) {
    return (
      <div className="container narrow stack">
        {query.error ? <ErrorMessage error={query.error} onRetry={query.error.status === 404 ? undefined : query.reload} /> : <Loading />}
        <Link to="/">← {t('nav.events')}</Link>
      </div>
    );
  }
  return <EventContent event={query.data} onStale={query.reload} />;
}

function EventContent({ event, onStale }: { event: EventDetail; onStale: () => void }) {
  const { t } = useLang();
  const [chosen, setChosen] = useState<Record<number, number>>({});
  // Les quantités restent bornées par le stock actuel, même après un rechargement.
  const selection = clampSelection(event.ticketTypes, chosen);
  const totalQuantity = selection.reduce((sum, s) => sum + s.quantity, 0);
  const quantityOf = (id: number) => selection.find((s) => s.ticketTypeId === id)?.quantity ?? 0;

  return (
    <div className="container">
      <Link to="/" className="small">
        ← {t('nav.events')}
      </Link>
      <div className="event-layout">
        <article className="stack">
          <div className="row small muted">
            <span className="collective-dot" style={{ background: event.collective.color }} />
            <Link to={`/c/${event.collective.slug}`}>{event.collective.name}</Link>
            {event.isOnline && <span className="badge badge-info">{t('list.online')}</span>}
          </div>
          <h1>{event.title}</h1>
          <EventTime iso={event.startsAt} timeZone={event.timezone} />
          {!event.isOnline && (
            <p>
              <span aria-hidden="true">📍 </span>
              {event.venue}
            </p>
          )}
          {event.description && <p className="muted pre-line">{event.description}</p>}
          <p className="small muted">
            {t('event.cancelPolicy', { h: event.cancelDeadlineHours })} {t('event.maxPerOrder', { n: event.maxPerOrder })}
          </p>
          {event.status === 'cancelled' && <div className="alert alert-error">{t('event.cancelled')}</div>}
          {event.status !== 'cancelled' && !event.salesOpen && <div className="alert alert-warn">{t('event.closed')}</div>}
        </article>

        {event.salesOpen && (
          <section className="card stack sticky" aria-labelledby="tickets-title">
            <h2 id="tickets-title">{t('event.tickets')}</h2>
            <ul className="plain-list">
              {event.ticketTypes.map((tt) => {
                const quantity = quantityOf(tt.id);
                return (
                  <TicketTypeRow
                    key={tt.id}
                    event={event}
                    ticketType={tt}
                    quantity={quantity}
                    max={maxSelectable(tt.available, event.maxPerOrder, totalQuantity - quantity)}
                    onChange={(q) => setChosen((prev) => ({ ...prev, [tt.id]: q }))}
                  />
                );
              })}
            </ul>
            {totalQuantity > 0 && (
              <CheckoutForm event={event} items={selection} totalCents={selectionTotal(event.ticketTypes, selection)} onSoldOut={onStale} />
            )}
          </section>
        )}
      </div>
    </div>
  );
}
