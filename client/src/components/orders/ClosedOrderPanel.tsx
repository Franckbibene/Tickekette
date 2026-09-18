import { Link } from 'react-router-dom';
import { useLang } from '../../hooks/useLang';
import type { Order } from '../../types/api';
import { OrderSummary } from './OrderSummary';

type ClosedStatus = 'expired' | 'cancelled' | 'refunded';

const STATUS_KEYS = {
  expired: 'order.status.expired',
  cancelled: 'order.status.cancelled',
  refunded: 'order.status.refunded',
} as const;

const REASON_KEYS = {
  buyer_cancelled: 'reason.buyer_cancelled',
  event_cancelled: 'reason.event_cancelled',
  late_payment_sold_out: 'reason.late_payment_sold_out',
  duplicate_payment: 'reason.duplicate_payment',
  amount_mismatch: 'reason.amount_mismatch',
} as const;

export function ClosedOrderPanel({ order, status }: { order: Order; status: ClosedStatus }) {
  const { t } = useLang();
  return (
    <section className="card stack">
      <div className={`alert ${status === 'refunded' ? 'alert-info' : 'alert-warn'}`}>
        {t(STATUS_KEYS[status])}
        {order.refundReason && (
          <>
            <br />
            <span className="small">{t(REASON_KEYS[order.refundReason])}</span>
          </>
        )}
      </div>
      <OrderSummary order={order} />
      <Link to={`/evenements/${order.event.id}`} className="btn">
        {t('order.backToEvent')}
      </Link>
    </section>
  );
}
