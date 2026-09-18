import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import type { Role } from '../types/api';
import { homeFor } from './paths';

// Garde de navigation : confort d'utilisation uniquement (on n'affiche pas une page
// inaccessible). Ce n'est PAS une protection : chaque route de l'API vérifie elle-même
// la session et le rôle côté serveur, et refuse (401/403/404) quoi que fasse le navigateur.
export function RequireRole({ roles, children }: { roles: Role[]; children: ReactNode }) {
  const { user } = useAuth();
  const location = useLocation();
  if (!user) return <Navigate to="/connexion" replace state={{ from: location.pathname }} />;
  if (!roles.includes(user.role)) return <Navigate to={homeFor(user.role)} replace />;
  return children;
}
