import { useLang } from '../../hooks/useLang';
import type { Order } from '../../types/api';
import { formatMoney } from '../../utils/format';

export function OrderSummary({ order }: { order: Order }) {
  const { t, lang } = useLang();
  return (
    <section aria-label={t('order.summary')}>
      <h3 className="overline">{t('order.summary')}</h3>
      <ul className="plain-list">
        {order.items.map((item) => (
          <li key={`${item.ticketTypeName}-${item.isEarly}`} className="spread small summary-line">
            <span>
              {item.quantity} × {item.ticketTypeName} {item.isEarly && <span className="badge badge-accent">{t('order.early')}</span>}
            </span>
            <span>{formatMoney(item.quantity * item.unitPriceCents, lang)}</span>
          </li>
        ))}
      </ul>
      <div className="total-line total-line-small">
        <span>{t('event.total')}</span>
        <span>{formatMoney(order.totalCents, lang)}</span>
      </div>
    </section>
  );
}
