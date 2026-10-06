import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { authApi } from '../api/auth';
import { UNAUTHORIZED_EVENT, isAbortError } from '../api/http';
import type { User } from '../types/api';
import { STORAGE_KEYS, clearOfflineData, storage } from '../utils/storage';
import { AuthContext } from './authContext';

// Seul un profil d'affichage est gardé dans le navigateur (nom, rôle, collectif) pour que
// l'écran de contrôle reste utilisable hors ligne. Il ne donne AUCUN droit : chaque appel
// à l'API est vérifié par le serveur à partir du cookie de session HttpOnly.
type CachedUser = Pick<User, 'id' | 'name' | 'role' | 'collective'>;

const toCache = (u: User): CachedUser => ({ id: u.id, name: u.name, role: u.role, collective: u.collective });

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(() =>
    storage.get<boolean>(STORAGE_KEYS.logoutPending, false) ? null : storage.get<CachedUser | null>(STORAGE_KEYS.user, null),
  );

  const forget = useCallback(() => {
    clearOfflineData();
    setUser(null);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const restore = async () => {
      if (storage.get<boolean>(STORAGE_KEYS.logoutPending, false)) {
        try {
          await authApi.logout();
          storage.set(STORAGE_KEYS.logoutPending, null);
        } catch (err) {
          // Une réponse HTTP prouve que le serveur est joignable : une session déjà
          // expirée est aussi une déconnexion effective. Hors ligne, on réessaiera.
          if (!isAbortError(err) && typeof (err as { status?: number }).status === 'number') {
            storage.set(STORAGE_KEYS.logoutPending, null);
          }
        }
        return;
      }
      try {
        const u = await authApi.me(controller.signal);
        storage.set(STORAGE_KEYS.user, toCache(u));
        setUser(u);
      } catch (err) {
        // Hors ligne : on garde le profil connu. Session absente ou expirée : on l'oublie.
        if (!isAbortError(err) && (err as { status?: number }).status === 401) forget();
      }
    };
    void restore();
    window.addEventListener(UNAUTHORIZED_EVENT, forget);
    return () => {
      controller.abort();
      window.removeEventListener(UNAUTHORIZED_EVENT, forget);
    };
  }, [forget]);

  const login = useCallback(async (email: string, password: string) => {
    const u = await authApi.login(email, password);
    storage.set(STORAGE_KEYS.user, toCache(u));
    setUser(u);
    return u;
  }, []);

  const logout = useCallback(async () => {
    storage.set(STORAGE_KEYS.logoutPending, true);
    try {
      await authApi.logout();
      storage.set(STORAGE_KEYS.logoutPending, null);
    } catch {
      // Hors ligne : le profil local est supprimé et la révocation serveur sera
      // retentée avant toute restauration de session au prochain démarrage.
    }
    forget();
  }, [forget]);

  const value = useMemo(() => ({ user, login, logout }), [user, login, logout]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
