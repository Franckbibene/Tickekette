import { useEffect, useState } from 'react';
import { storage } from '../utils/storage';

// État React sauvegardé dans le navigateur (survit à un rechargement de page sans réseau).
// Les données opérationnelles sensibles doivent avoir une expiration et être effacées
// à la déconnexion (voir utils/storage.ts).
export function usePersistentState<T>(key: string, initial: T) {
  const [value, setValue] = useState<T>(() => storage.get<T>(key, initial));
  useEffect(() => {
    storage.set(key, value);
  }, [key, value]);
  return [value, setValue] as const;
}
