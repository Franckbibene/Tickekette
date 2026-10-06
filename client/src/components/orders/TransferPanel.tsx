import type { FetchedOrder } from '../../api/orders';
import { useLang } from '../../hooks/useLang';
import { formatDateTime, formatMoney } from '../../utils/format';
import { OrderSummary } from './OrderSummary';
import { ReleaseSeatsButton } from './ReleaseSeatsButton';

export function TransferPanel({ order, onChanged }: { order: FetchedOrder; onChanged: (order: FetchedOrder) => void }) {
  const { t, lang } = useLang();
  return (
    <section className="card stack">
      <h2>{t('order.transferTitle')}</h2>
      <p className="muted">{t('order.transferExplain')}</p>
      <dl className="kv">
        <dt>{t('order.amount')}</dt>
        <dd>{formatMoney(order.totalCents, lang)}</dd>
        {order.bank && (
          <>
            <dt>{t('order.iban')}</dt>
            <dd className="mono">{order.bank.iban}</dd>
            <dt>{t('order.reference')}</dt>
            <dd className="mono">{order.bank.reference}</dd>
          </>
        )}
        <dt>{t('order.deadline')}</dt>
        <dd>{formatDateTime(order.expiresAt, order.event.timezone, lang)}</dd>
      </dl>
      <OrderSummary order={order} />
      <ReleaseSeatsButton onChanged={onChanged} />
    </section>
  );
}
