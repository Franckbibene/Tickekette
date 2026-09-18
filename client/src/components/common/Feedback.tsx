import type { ReactNode } from 'react';
import type { ApiError } from '../../api/http';
import { useLang } from '../../hooks/useLang';

export function Loading() {
  const { t } = useLang();
  return (
    <p className="muted" role="status">
      {t('common.loading')}
    </p>
  );
}

export function ErrorMessage({ error, onRetry }: { error: ApiError | null; onRetry?: () => void }) {
  const { t } = useLang();
  if (!error) return null;
  return (
    <div className="alert alert-error" role="alert">
      {error.message}
      {onRetry && (
        <>
          {' '}
          <button type="button" className="btn btn-small" onClick={onRetry}>
            {t('common.retry')}
          </button>
        </>
      )}
    </div>
  );
}

export function EmptyState({ children }: { children: ReactNode }) {
  return <p className="muted">{children}</p>;
}
