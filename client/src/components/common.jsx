import { useCallback, useEffect, useRef, useState } from 'react';
import { useLang } from '../i18n.jsx';
import { cityOf, formatDateTime, formatTime, sameClock, userTimeZone } from '../time.js';

// Heure de l'événement à l'heure du lieu + à l'heure du visiteur si différente (5.10).
export function EventTime({ iso, timeZone, compact = false }) {
  const { t, lang } = useLang();
  const mine = userTimeZone();
  const differs = !sameClock(iso, timeZone, mine);
  return (
    <div className="event-time">
      <div>
        <strong>{formatDateTime(iso, timeZone, lang)}</strong>{' '}
        <span className="muted small">({t('time.local', { city: cityOf(timeZone) })})</span>
      </div>
      {differs && (
        <div className="tz-hint">
          🌍{' '}
          {t('time.yours', {
            time: compact ? formatTime(iso, mine, lang) : formatDateTime(iso, mine, lang),
            city: cityOf(mine),
          })}
        </div>
      )}
    </div>
  );
}

export function Loading() {
  const { t } = useLang();
  return (
    <p className="muted" role="status">
      {t('common.loading')}
    </p>
  );
}

export function ErrorMessage({ error }) {
  const { t } = useLang();
  if (!error) return null;
  return (
    <div className="alert alert-error" role="alert">
      {error.message || t('common.error')}
    </div>
  );
}

// Charge une ressource et la recharge à intervalle régulier si `intervalMs` est donné.
export function useResource(loader, deps, { intervalMs } = {}) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const loaderRef = useRef(loader);
  loaderRef.current = loader;

  const reload = useCallback(
    () =>
      loaderRef
        .current()
        .then((d) => {
          setData(d);
          setError(null);
          return d;
        })
        .catch((e) => setError(e)),
    [],
  );

  useEffect(() => {
    setData(null);
    reload();
    if (!intervalMs) return undefined;
    const id = setInterval(() => {
      if (document.visibilityState === 'visible') reload();
    }, intervalMs);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return { data, error, reload, setData };
}

const STATUS_LABELS = {
  order: {
    pending: ['En attente de paiement', 'badge-warn'],
    paid: ['Payée', 'badge-good'],
    expired: ['Expirée', ''],
    cancelled: ['Abandonnée', ''],
    refunded: ['Remboursée', 'badge-info'],
  },
  event: {
    draft: ['Brouillon', ''],
    published: ['En vente', 'badge-good'],
    cancelled: ['Annulé', 'badge-bad'],
  },
  waitlist: {
    waiting: ['En attente', 'badge-warn'],
    offered: ['Place proposée', 'badge-info'],
    converted: ['A acheté', 'badge-good'],
    expired: ['Délai dépassé', ''],
    declined: ['A refusé', ''],
  },
};

export function StatusBadge({ status, kind = 'order' }) {
  const [label, cls] = STATUS_LABELS[kind][status] ?? [status, ''];
  return <span className={`badge ${cls}`}>{label}</span>;
}
