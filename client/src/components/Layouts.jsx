import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom';
import { homeFor, useAuth } from '../auth.jsx';
import { useLang } from '../i18n.jsx';

function LangSwitch() {
  const { lang, setLang } = useLang();
  return (
    <div className="lang-switch" role="group" aria-label="Langue / Language">
      {['fr', 'en'].map((l) => (
        <button key={l} type="button" aria-pressed={lang === l} onClick={() => setLang(l)}>
          {l.toUpperCase()}
        </button>
      ))}
    </div>
  );
}

export function PublicLayout() {
  const { t } = useLang();
  const { user } = useAuth();
  return (
    <>
      <header className="site-header">
        <div className="container">
          <Link to="/" className="brand">
            <img src="/favicon.svg" alt="" />
            Tickekette
          </Link>
          <nav className="nav" aria-label="Navigation principale">
            <NavLink to="/" end>
              {t('nav.events')}
            </NavLink>
            <NavLink to={user ? homeFor(user) : '/connexion'}>{t('nav.pro')}</NavLink>
          </nav>
          <LangSwitch />
        </div>
      </header>
      <main>
        <Outlet />
      </main>
      <footer className="site-footer">
        <div className="container spread">
          <span>{t('footer.text')}</span>
          <Link to="/dev/mails">{t('nav.mails')}</Link>
        </div>
      </footer>
    </>
  );
}

export function AdminLayout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const isSuper = user.role === 'superadmin';
  return (
    <div className="admin-shell">
      <header className="admin-bar">
        <div className="container">
          <Link to={isSuper ? '/plateforme' : '/admin'} className="brand">
            <img src="/favicon.svg" alt="" />
            <span>
              Tickekette{' '}
              <span className="small" style={{ fontWeight: 500, opacity: 0.75 }}>
                {isSuper ? 'Plateforme' : user.collective?.name}
              </span>
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
            <NavLink to="/dev/mails">Mails</NavLink>
            <a
              href="/"
              onClick={(e) => {
                e.preventDefault();
                logout();
                navigate('/');
              }}
            >
              Déconnexion
            </a>
          </nav>
        </div>
      </header>
      <main>
        <div className="container">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
