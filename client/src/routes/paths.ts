import type { Role } from '../types/api';

// Page d'accueil de chaque rôle après connexion.
export const homeFor = (role: Role): string => ({ superadmin: '/plateforme', admin: '/admin', controller: '/controle' })[role];
