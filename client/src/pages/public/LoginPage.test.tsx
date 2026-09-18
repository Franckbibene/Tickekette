import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ApiError } from '../../api/http';
import { adminUser, renderWithProviders } from '../../test/renderWithProviders';
import LoginPage from './LoginPage';

describe('connexion', () => {
  it('identifiants refusés : message clair, pas de détail technique', async () => {
    const login = vi.fn().mockRejectedValue(new ApiError(401, 'bad_credentials', 'E-mail ou mot de passe incorrect.'));
    const user = userEvent.setup();
    renderWithProviders(<LoginPage />, { path: '/connexion', route: '/connexion', auth: { login } });
    await user.type(screen.getByLabelText(/E-mail/), 'admin@exemple.fr');
    await user.type(screen.getByLabelText(/Mot de passe/), 'mauvais');
    await user.click(screen.getByRole('button', { name: 'Se connecter' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('E-mail ou mot de passe incorrect.');
    expect(login).toHaveBeenCalledWith('admin@exemple.fr', 'mauvais');
  });

  it('e-mail invalide : aucune requête envoyée', async () => {
    const login = vi.fn();
    const user = userEvent.setup();
    renderWithProviders(<LoginPage />, { path: '/connexion', route: '/connexion', auth: { login } });
    await user.type(screen.getByLabelText(/E-mail/), 'admin');
    await user.type(screen.getByLabelText(/Mot de passe/), 'motdepasse');
    await user.click(screen.getByRole('button', { name: 'Se connecter' }));
    expect(screen.getByText('Adresse e-mail invalide.')).toBeInTheDocument();
    expect(login).not.toHaveBeenCalled();
  });

  it('déjà connecté : redirigé vers son espace', () => {
    renderWithProviders(<LoginPage />, {
      path: '/connexion',
      route: '/connexion',
      user: adminUser,
      extraRoutes: [],
    });
    expect(screen.queryByRole('button', { name: 'Se connecter' })).not.toBeInTheDocument();
  });
});
