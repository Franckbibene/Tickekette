import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { adminApi } from '../../api/admin';
import { EventActions } from '../../components/admin/EventActions';
import { GateTab } from '../../components/admin/GateTab';
import { KpiTiles } from '../../components/admin/KpiTiles';
import { OrdersTab } from '../../components/admin/OrdersTab';
import { SalesTab } from '../../components/admin/SalesTab';
import { WaitlistTab } from '../../components/admin/WaitlistTab';
import { EventTime } from '../../components/common/EventTime';
import { ErrorMessage } from '../../components/common/Feedback';
import { QueryView } from '../../components/common/QueryView';
import { EventStatusBadge } from '../../components/common/StatusBadge';
import { Tabs } from '../../components/common/Tabs';
import { useApiQuery } from '../../hooks/useApiQuery';
import { useAsyncAction } from '../../hooks/useAsyncAction';
import type { AdminEvent } from '../../types/api';
import { formatTime } from '../../utils/format';
import { parseRouteId } from '../../utils/url';
import NotFoundPage from '../public/NotFoundPage';

// (5.8) Chiffres rafraîchis toutes les 5 secondes.
const STATS_REFRESH_MS = 5000;

type TabKey = 'sales' | 'orders' | 'waitlist' | 'gate';

export default function AdminEventPage() {
  const eventId = parseRouteId(useParams().id);
  const event = useApiQuery(eventId === null ? null : `admin:event:${eventId}`, (signal) => adminApi.event(eventId ?? 0, signal));
  if (eventId === null) return <NotFoundPage />;
  return (
    <div className="stack">
      <Link to="/admin" className="small">
        ← Événements
      </Link>
      <QueryView query={event}>{(data) => <EventDashboard event={data} onChanged={event.setData} />}</QueryView>
    </div>
  );
}

function EventDashboard({ event, onChanged }: { event: AdminEvent; onChanged: (event: AdminEvent) => void }) {
  const stats = useApiQuery(`admin:stats:${event.id}`, (signal) => adminApi.stats(event.id, signal), { intervalMs: STATS_REFRESH_MS });
  const publish = useAsyncAction(async () => onChanged(await adminApi.publishEvent(event.id)));
  const [tab, setTab] = useState<TabKey>('sales');
  const alertCount = stats.data?.alerts.length ?? 0;

  return (
    <>
      <div className="spread align-start">
        <div>
          <div className="row">
            <EventStatusBadge status={event.status} />
            {event.isOnline && <span className="badge badge-info">En ligne</span>}
          </div>
          <h1>{event.title}</h1>
          <EventTime iso={event.startsAt} timeZone={event.timezone} />
          <p className="muted">{event.isOnline ? event.onlineUrl : event.venue}</p>
        </div>
        <div className="row">
          {event.status === 'draft' && (
            <button type="button" className="btn btn-primary" disabled={publish.pending} onClick={() => void publish.run()}>
              Publier
            </button>
          )}
          {event.status !== 'cancelled' && (
            <Link className="btn" to={`/admin/evenements/${event.id}/modifier`}>
              Modifier
            </Link>
          )}
          {event.status !== 'draft' && (
            <Link className="btn" to={`/evenements/${event.id}`}>
              Page publique
            </Link>
          )}
        </div>
      </div>
      <ErrorMessage error={publish.error} />

      <QueryView query={stats}>
        {(data) => (
          <>
            <KpiTiles stats={data} />
            <p className="small muted">
              <span className="live-dot" aria-hidden="true" />
              Mis à jour à {formatTime(data.updatedAt, event.timezone)} — actualisation automatique toutes les 5 s
            </p>
            <Tabs
              label="Détails de l’événement"
              active={tab}
              onChange={setTab}
              tabs={[
                { key: 'sales', label: 'Ventes par type' },
                { key: 'orders', label: 'Commandes' },
                { key: 'waitlist', label: 'Liste d’attente' },
                { key: 'gate', label: alertCount > 0 ? `Contrôle (${alertCount} alertes)` : 'Contrôle' },
              ]}
            >
              {tab === 'sales' && <SalesTab stats={data} />}
              {tab === 'orders' && <OrdersTab eventId={event.id} timeZone={event.timezone} />}
              {tab === 'waitlist' && <WaitlistTab eventId={event.id} timeZone={event.timezone} />}
              {tab === 'gate' && <GateTab stats={data} timeZone={event.timezone} />}
            </Tabs>
          </>
        )}
      </QueryView>
      <EventActions event={event} onChanged={onChanged} />
    </>
  );
}
