import { useCallback, useEffect, useEffectEvent, useState } from 'react';
import { ApiError, isAbortError, toApiError } from '../api/http';

interface QueryState<T> {
  key: string | null;
  data: T | null;
  error: ApiError | null;
}

export interface ApiQuery<T> {
  data: T | null;
  error: ApiError | null;
  loading: boolean;
  reload: () => void;
  setData: (data: T) => void;
}

// Charge une ressource de l'API et la garde à jour.
// - `key` identifie la ressource : quand elle change, l'ancienne requête est annulée.
// - `intervalMs` : rechargement périodique (uniquement quand l'onglet est visible).
// - Une requête en cours est annulée quand le composant disparaît.
export function useApiQuery<T>(
  key: string | null,
  fetcher: (signal: AbortSignal) => Promise<T>,
  { intervalMs }: { intervalMs?: number } = {},
): ApiQuery<T> {
  const [state, setState] = useState<QueryState<T>>({ key: null, data: null, error: null });
  const [reloadCount, setReloadCount] = useState(0);
  const load = useEffectEvent((signal: AbortSignal) => fetcher(signal));

  useEffect(() => {
    if (key === null) return undefined;
    const controller = new AbortController();
    const run = () =>
      load(controller.signal)
        .then((data) => setState({ key, data, error: null }))
        .catch((err: unknown) => {
          if (isAbortError(err)) return;
          // En cas d'échec d'un rechargement, on garde les dernières données valides.
          setState((prev) => ({ key, data: prev.key === key ? prev.data : null, error: toApiError(err) }));
        });
    void run();
    const timer = intervalMs
      ? window.setInterval(() => {
          if (document.visibilityState === 'visible') void run();
        }, intervalMs)
      : undefined;
    return () => {
      controller.abort();
      window.clearInterval(timer);
    };
  }, [key, intervalMs, reloadCount]);

  const reload = useCallback(() => setReloadCount((n) => n + 1), []);
  const setData = useCallback((data: T) => setState({ key, data, error: null }), [key]);
  const current = state.key === key;
  return {
    data: current ? state.data : null,
    error: current ? state.error : null,
    loading: key !== null && (!current || (state.data === null && state.error === null)),
    reload,
    setData,
  };
}
