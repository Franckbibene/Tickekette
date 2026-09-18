import { screen } from '@testing-library/react';
import { Route } from 'react-router-dom';
import { adminUser, renderWithProviders } from '../test/renderWithProviders';
import { RequireRole } from './RequireRole';

const extraRoutes = [
  <Route key="login" path="/connexion" element={<p>Page de connexion</p>} />,
  <Route key="admin" path="/admin" element={<p>Accueil admin</p>} />,
  <Route key="scan" path="/controle" element={<p>Accueil contrôle</p>} />,
];

describe('RequireRole (confort d’utilisation, la sécurité est côté serveur)', () => {
  it('non connecté : redirection vers la connexion', () => {
    renderWithProviders(
      <RequireRole roles={['admin']}>
        <p>Secret</p>
      </RequireRole>,
      { path: '/admin/equipe', route: '/admin/equipe', extraRoutes },
    );
    expect(screen.getByText('Page de connexion')).toBeInTheDocument();
    expect(screen.queryByText('Secret')).not.toBeInTheDocument();
  });

  it('mauvais rôle : renvoyé vers sa propre page d’accueil', () => {
    renderWithProviders(
      <RequireRole roles={['admin']}>
        <p>Secret</p>
      </RequireRole>,
      { path: '/admin/equipe', route: '/admin/equipe', extraRoutes, user: { ...adminUser, role: 'controller' } },
    );
    expect(screen.getByText('Accueil contrôle')).toBeInTheDocument();
  });

  it('bon rôle : page affichée', () => {
    renderWithProviders(
      <RequireRole roles={['admin']}>
        <p>Secret</p>
      </RequireRole>,
      { path: '/admin/equipe', route: '/admin/equipe', extraRoutes, user: adminUser },
    );
    expect(screen.getByText('Secret')).toBeInTheDocument();
  });
});
