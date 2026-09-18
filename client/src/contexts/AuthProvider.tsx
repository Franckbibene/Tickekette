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
  const [user, setUser] = useState<User | null>(() => storage.get<CachedUser | null>(STORAGE_KEYS.user, null));

  const forget = useCallback(() => {
    clearOfflineData();
    setUser(null);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    authApi
      .me(controller.signal)
      .then((u) => {
        storage.set(STORAGE_KEYS.user, toCache(u));
        setUser(u);
      })
      .catch((err: unknown) => {
        // Hors ligne : on garde le profil connu. Session absente ou expirée : on l'oublie.
        if (!isAbortError(err) && (err as { status?: number }).status === 401) forget();
      });
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
    try {
      await authApi.logout();
    } catch {
      // Hors ligne : le cookie ne peut pas être effacé maintenant, il expirera de lui-même.
    }
    forget();
  }, [forget]);

  const value = useMemo(() => ({ user, login, logout }), [user, login, logout]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
