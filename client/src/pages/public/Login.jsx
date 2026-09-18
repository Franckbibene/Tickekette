import { useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { homeFor, useAuth } from '../../auth.jsx';
import { ErrorMessage } from '../../components/common.jsx';

const DEMO_ACCOUNTS = [
  ['admin@nuits.test', 'Admin — Les Nuits de la Garonne'],
  ['controle@nuits.test', 'Contrôleur — Les Nuits de la Garonne'],
  ['admin@bassins.test', 'Admin — Collectif Bassins'],
  ['admin@ondes.test', 'Admin — Ondes Lointaines'],
  ['super@tickekette.test', 'Super-admin de la plateforme'],
];

export default function Login() {
  const { user, login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  if (user) return <Navigate to={homeFor(user)} replace />;

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const u = await login(email, password);
      const from = location.state?.from;
      navigate(from && from !== '/connexion' ? from : homeFor(u), { replace: true });
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  }

  return (
    <div className="container narrow stack">
      <h1>Espace organisateur</h1>
      <form className="card stack" onSubmit={submit}>
        <label className="field">
          <span>E-mail</span>
          <input type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label className="field">
          <span>Mot de passe</span>
          <input
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        <ErrorMessage error={error} />
        <button className="btn btn-primary btn-block" disabled={busy}>
          Se connecter
        </button>
      </form>
      <section className="card stack">
        <h2>Comptes de démonstration</h2>
        <p className="small muted">
          Mot de passe : <code>demo1234</code>. Cliquez pour préremplir.
        </p>
        <div className="stack" style={{ gap: 6 }}>
          {DEMO_ACCOUNTS.map(([mail, label]) => (
            <button
              key={mail}
              type="button"
              className="btn btn-small"
              style={{ justifyContent: 'space-between', width: '100%', marginTop: 6 }}
              onClick={() => {
                setEmail(mail);
                setPassword('demo1234');
              }}
            >
              <span>{label}</span>
              <span className="mono muted">{mail}</span>
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}
