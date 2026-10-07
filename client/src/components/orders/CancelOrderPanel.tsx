import { useState } from 'react';
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
  const [codeRequested, setCodeRequested] = useState(false);
  const [confirmationCode, setConfirmationCode] = useState('');
  const requestCode = useAsyncAction(async () => {
    await ordersApi.requestCancellationCode();
    setCodeRequested(true);
  });
  const cancel = useAsyncAction(async () => onChanged(await ordersApi.cancel(confirmationCode)));
  const deadline = formatDateTime(order.cancelDeadline, order.event.timezone, lang);

  return (
    <section className="card stack no-print">
      <h2>{t('order.cancelTitle')}</h2>
      <OrderSummary order={order} />
      {order.canCancel ? (
        <>
          <p className="muted">{t('order.cancelUntil', { date: deadline })}</p>
          <ErrorMessage error={requestCode.error ?? cancel.error} />
          {codeRequested ? (
            <>
              <div className="field">
                <label htmlFor="cancel-code">Code reçu par e-mail</label>
                <input
                  id="cancel-code"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  pattern="[0-9]{6}"
                  maxLength={6}
                  value={confirmationCode}
                  onChange={(e) => setConfirmationCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                />
              </div>
              <button
                type="button"
                className="btn btn-danger"
                disabled={cancel.pending || confirmationCode.length !== 6}
                onClick={() => {
                  if (window.confirm(t('order.cancelConfirm'))) void cancel.run();
                }}
              >
                {t('order.cancelBtn')}
              </button>
            </>
          ) : (
            <button type="button" className="btn btn-danger" disabled={requestCode.pending} onClick={() => void requestCode.run()}>
              Recevoir le code d’annulation
            </button>
          )}
        </>
      ) : (
        <p className="muted">{t('order.cancelClosed', { date: deadline })}</p>
      )}
    </section>
  );
}
