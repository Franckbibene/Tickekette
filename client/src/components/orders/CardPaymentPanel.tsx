import { useNavigate } from 'react-router-dom';
import { ApiError } from '../../api/http';
import { ordersApi, type FetchedOrder } from '../../api/orders';
import { useAsyncAction } from '../../hooks/useAsyncAction';
import { useCountdown } from '../../hooks/useCountdown';
import { useLang } from '../../hooks/useLang';
import { formatDuration, formatMoney } from '../../utils/format';
import { safeInternalPath } from '../../utils/url';
import { ErrorMessage } from '../common/Feedback';
import { OrderSummary } from './OrderSummary';
import { ReleaseSeatsButton } from './ReleaseSeatsButton';

const PAYMENT_PAGE_PREFIX = '/paiement-simule/';

interface Props {
  order: FetchedOrder;
  onChanged: (order: FetchedOrder) => void;
  onExpired: () => void;
}

export function CardPaymentPanel({ order, onChanged, onExpired }: Props) {
  const { t, lang } = useLang();
  const navigate = useNavigate();
  const skew = Date.parse(order.serverNow) - order.receivedAt;
  const remaining = useCountdown(order.expiresAt, skew);
  const pay = useAsyncAction(async () => {
    const { redirectUrl } = await ordersApi.checkout();
    // On ne suit qu'une redirection vers notre propre page de paiement (pas d'open redirect).
    const target = safeInternalPath(redirectUrl, '');
    if (!target.startsWith(PAYMENT_PAGE_PREFIX)) throw new ApiError(0, 'invalid_redirect', 'Paiement indisponible, réessayez.');
    void navigate(target);
  });
  const expired = remaining === 0;
  const time = remaining === null ? '' : formatDuration(remaining);

  return (
    <section className="card stack">
      {order.isWaitlistOffer && <div className="alert alert-success">{t('order.offer')}</div>}
      <h2>{t('order.reserved')}</h2>
      <div className="countdown" aria-hidden="true">
        {time}
      </div>
      <p className="muted">{t('order.expiresIn', { time })}</p>
      <OrderSummary order={order} />
      <ErrorMessage error={pay.error} />
      <button
        type="button"
        className="btn btn-primary btn-block btn-large"
        onClick={() => {
          if (expired) onExpired();
          else void pay.run();
        }}
        disabled={pay.pending || expired}
      >
        {t('order.pay', { amount: formatMoney(order.totalCents, lang) })}
      </button>
      <ReleaseSeatsButton onChanged={onChanged} />
    </section>
  );
}
