import { ordersApi, type FetchedOrder } from '../../api/orders';
import { useAsyncAction } from '../../hooks/useAsyncAction';
import { useLang } from '../../hooks/useLang';
import { formatDateTime } from '../../utils/format';
import { ErrorMessage } from '../common/Feedback';
import { OrderSummary } from './OrderSummary';

// Le bouton n'apparaît que si l'annulation est possible ; le serveur revérifie
// quand même le délai et l'état de la commande (5.5).
export function CancelOrderPanel({ order, onChanged }: { order: FetchedOrder; onChanged: (order: FetchedOrder) => void }) {
  const { t, lang } = useLang();
  const cancel = useAsyncAction(async () => onChanged(await ordersApi.cancel(order.token)));
  const deadline = formatDateTime(order.cancelDeadline, order.event.timezone, lang);

  return (
    <section className="card stack no-print">
      <h2>{t('order.cancelTitle')}</h2>
      <OrderSummary order={order} />
      {order.canCancel ? (
        <>
          <p className="muted">{t('order.cancelUntil', { date: deadline })}</p>
          <ErrorMessage error={cancel.error} />
          <button
            type="button"
            className="btn btn-danger"
            disabled={cancel.pending}
            onClick={() => {
              if (window.confirm(t('order.cancelConfirm'))) void cancel.run();
            }}
          >
            {t('order.cancelBtn')}
          </button>
        </>
      ) : (
        <p className="muted">{t('order.cancelClosed', { date: deadline })}</p>
      )}
    </section>
  );
}
