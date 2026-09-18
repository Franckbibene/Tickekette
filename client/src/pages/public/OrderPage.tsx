import { Link, useParams } from 'react-router-dom';
import { ordersApi } from '../../api/orders';
import { EventTime } from '../../components/common/EventTime';
import { ErrorMessage, Loading } from '../../components/common/Feedback';
import { CancelOrderPanel } from '../../components/orders/CancelOrderPanel';
import { CardPaymentPanel } from '../../components/orders/CardPaymentPanel';
import { ClosedOrderPanel } from '../../components/orders/ClosedOrderPanel';
import { TicketList } from '../../components/orders/TicketList';
import { TransferPanel } from '../../components/orders/TransferPanel';
import { useApiQuery } from '../../hooks/useApiQuery';
import { useLang } from '../../hooks/useLang';

// Rafraîchissement : le statut change dès que le paiement est confirmé ou que le délai expire.
const REFRESH_MS = 4000;

export default function OrderPage() {
  const token = useParams().token ?? '';
  const { t } = useLang();
  const query = useApiQuery(`order:${token}`, (signal) => ordersApi.get(token, signal), { intervalMs: REFRESH_MS });
  const order = query.data;

  if (!order) {
    return (
      <div className="container narrow">
        {!query.error && <Loading />}
        {query.error?.status === 404 ? (
          <div className="alert alert-error" role="alert">
            {t('order.notFound')}
          </div>
        ) : (
          <ErrorMessage error={query.error} onRetry={query.reload} />
        )}
      </div>
    );
  }

  const { event } = order;
  return (
    <div className="container narrow stack">
      <div className="no-print">
        <Link to={`/evenements/${event.id}`} className="small">
          ← {event.title}
        </Link>
      </div>
      <header>
        <p className="small muted mono">{t('order.title', { ref: order.reference })}</p>
        <h1>{event.title}</h1>
        <EventTime iso={event.startsAt} timeZone={event.timezone} />
        {!event.isOnline && <p className="event-venue">{event.venue}</p>}
      </header>

      {query.error && <ErrorMessage error={query.error} />}
      {order.status === 'pending' && order.paymentMethod === 'card' && (
        <CardPaymentPanel order={order} onChanged={query.setData} onExpired={query.reload} />
      )}
      {order.status === 'pending' && order.paymentMethod === 'transfer' && <TransferPanel order={order} onChanged={query.setData} />}
      {order.status === 'paid' && (
        <>
          <TicketList order={order} />
          <CancelOrderPanel order={order} onChanged={query.setData} />
        </>
      )}
      {order.status !== 'pending' && order.status !== 'paid' && <ClosedOrderPanel order={order} status={order.status} />}
    </div>
  );
}
