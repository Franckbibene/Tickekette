import { Suspense } from 'react';
import { Link, NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';
import { Loading } from '../common/Feedback';
import { useLang } from '../../hooks/useLang';
import { homeFor } from '../../routes/paths';
import { LangSwitch } from './LangSwitch';

export function PublicLayout() {
  const { t } = useLang();
  const { user } = useAuth();
  return (
    <>
      <a className="skip-link" href="#contenu">
        Aller au contenu
      </a>
      <header className="site-header">
        <div className="container">
          <Link to="/" className="brand">
            <img src="/favicon.svg" alt="" width="28" height="28" />
            Tickekette
          </Link>
          <nav className="nav" aria-label={t('nav.main')}>
            <NavLink to="/" end>
              {t('nav.events')}
            </NavLink>
            <NavLink to={user ? homeFor(user.role) : '/connexion'}>{t('nav.pro')}</NavLink>
          </nav>
          <LangSwitch />
        </div>
      </header>
      <main id="contenu">
        <Suspense fallback={<Loading />}>
          <Outlet />
        </Suspense>
      </main>
      <footer className="site-footer">
        <div className="container spread">
          <span>{t('footer.text')}</span>
          {import.meta.env.DEV && <Link to="/dev/mails">{t('nav.mails')}</Link>}
        </div>
      </footer>
    </>
  );
}
