import { ordersApi, type FetchedOrder } from '../../api/orders';
import { useAsyncAction } from '../../hooks/useAsyncAction';
import { useLang } from '../../hooks/useLang';
import { ErrorMessage } from '../common/Feedback';

export function ReleaseSeatsButton({ token, onChanged }: { token: string; onChanged: (order: FetchedOrder) => void }) {
  const { t } = useLang();
  const release = useAsyncAction(async () => onChanged(await ordersApi.cancel(token)));
  return (
    <>
      <ErrorMessage error={release.error} />
      <button
        type="button"
        className="btn btn-ghost btn-small"
        disabled={release.pending}
        onClick={() => {
          if (window.confirm(t('order.releaseConfirm'))) void release.run();
        }}
      >
        {t('order.release')}
      </button>
    </>
  );
}
