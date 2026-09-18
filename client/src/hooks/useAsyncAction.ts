import { useRef, useState } from 'react';
import { ApiError, toApiError } from '../api/http';

// Exécute une action asynchrone (envoi de formulaire, bouton…) en empêchant la double
// soumission : tant qu'elle est en cours, les nouveaux appels sont ignorés, même si
// l'utilisateur clique deux fois avant que le bouton ne soit désactivé à l'écran.
export function useAsyncAction<Args extends unknown[], Result>(action: (...args: Args) => Promise<Result>) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const inFlight = useRef(false);

  async function run(...args: Args): Promise<Result | undefined> {
    if (inFlight.current) return undefined;
    inFlight.current = true;
    setPending(true);
    setError(null);
    try {
      return await action(...args);
    } catch (err) {
      setError(toApiError(err));
      return undefined;
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  }

  return { run, pending, error, setError };
}
