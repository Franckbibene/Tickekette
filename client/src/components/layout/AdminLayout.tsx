import { Suspense } from 'react';
import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';
import { Loading } from '../common/Feedback';
import { useAsyncAction } from '../../hooks/useAsyncAction';

export function AdminLayout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const signOut = useAsyncAction(async () => {
    await logout();
    void navigate('/', { replace: true });
  });
  const isSuper = user?.role === 'superadmin';

  return (
    <div className="admin-shell">
      <a className="skip-link" href="#contenu">
        Aller au contenu
      </a>
      <header className="admin-bar">
        <div className="container">
          <Link to={isSuper ? '/plateforme' : '/admin'} className="brand">
            <img src="/favicon.svg" alt="" width="28" height="28" />
            <span>
              Tickekette <span className="brand-sub">{isSuper ? 'Plateforme' : user?.collective?.name}</span>
            </span>
          </Link>
          <nav className="nav" aria-label="Espace organisateur">
            {isSuper ? (
              <NavLink to="/plateforme" end>
                Collectifs
              </NavLink>
            ) : (
              <>
                <NavLink to="/admin" end>
                  Événements
                </NavLink>
                <NavLink to="/admin/virements">Virements</NavLink>
                <NavLink to="/admin/equipe">Équipe</NavLink>
                <NavLink to="/controle">Contrôle</NavLink>
              </>
            )}
            {import.meta.env.DEV && <NavLink to="/dev/mails">Mails</NavLink>}
            <button type="button" className="nav-button" onClick={() => void signOut.run()} disabled={signOut.pending}>
              Déconnexion
            </button>
          </nav>
        </div>
      </header>
      <main id="contenu">
        <div className="container">
          <Suspense fallback={<Loading />}>
            <Outlet />
          </Suspense>
        </div>
      </main>
    </div>
  );
}
