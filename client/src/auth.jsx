import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { api, getToken, setToken, storage } from './api.js';

const USER_KEY = 'tkk_user';
const AuthContext = createContext(null);

export const homeFor = (user) =>
  ({ superadmin: '/plateforme', admin: '/admin', controller: '/controle' })[user?.role] ?? '/';

export function AuthProvider({ children }) {
  // L'utilisateur est gardé en local : l'écran de contrôle reste accessible hors ligne.
  const [user, setUser] = useState(() => (getToken() ? storage.get(USER_KEY) : null));

  const logout = useCallback(() => {
    setToken(null);
    storage.set(USER_KEY, null);
    setUser(null);
  }, []);

  useEffect(() => {
    if (!getToken()) return;
    api('/auth/me')
      .then((u) => {
        storage.set(USER_KEY, u);
        setUser(u);
      })
      .catch((err) => {
        if (err.status === 401) logout();
      });
  }, [logout]);

  const login = useCallback(async (email, password) => {
    const { token, user: u } = await api('/auth/login', { method: 'POST', body: { email, password } });
    setToken(token);
    storage.set(USER_KEY, u);
    setUser(u);
    return u;
  }, []);

  const value = useMemo(() => ({ user, login, logout }), [user, login, logout]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);

export function RequireRole({ roles, children }) {
  const { user } = useAuth();
  const location = useLocation();
  if (!user) return <Navigate to="/connexion" replace state={{ from: location.pathname }} />;
  if (!roles.includes(user.role)) return <Navigate to={homeFor(user)} replace />;
  return children;
}
