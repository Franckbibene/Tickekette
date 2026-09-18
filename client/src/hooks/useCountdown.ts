import { useEffect, useState } from 'react';

const TICK_MS = 1000;

// Temps restant avant `deadline`, mis à jour chaque seconde.
// `clockSkewMs` corrige l'horloge du téléphone avec celle du serveur.
// Null tant que le premier calcul n'a pas eu lieu ou si aucune échéance n'est donnée.
export function useCountdown(deadline: string | null, clockSkewMs: number): number | null {
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    if (!deadline) return undefined;
    const tick = () => setNow(Date.now());
    const first = window.setTimeout(tick, 0);
    const timer = window.setInterval(tick, TICK_MS);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(timer);
    };
  }, [deadline]);

  if (!deadline || now === null) return null;
  return Math.max(0, Date.parse(deadline) - (now + clockSkewMs));
}
