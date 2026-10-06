import { useState, type SubmitEvent } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { ErrorMessage } from '../../components/common/Feedback';
import { TextField } from '../../components/forms/Field';
import { useAsyncAction } from '../../hooks/useAsyncAction';
import { useAuth } from '../../hooks/useAuth';
import { homeFor } from '../../routes/paths';
import { FIELD_LIMITS, validateEmail } from '../../utils/validation';
import { safeInternalPath } from '../../utils/url';
import { DemoAccounts } from './DemoAccounts';

export default function LoginPage() {
  const { user, login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [emailError, setEmailError] = useState<string>();
  const submit = useAsyncAction(async () => {
    const u = await login(email.trim(), password);
    // Retour à la page demandée avant la connexion : chemin interne uniquement (pas d'open redirect).
    const from = safeInternalPath((location.state as { from?: unknown } | null)?.from, homeFor(u.role));
    void navigate(from === '/connexion' ? homeFor(u.role) : from, { replace: true });
  });

  if (user) return <Navigate to={homeFor(user.role)} replace />;

  function onSubmit(e: SubmitEvent<HTMLFormElement>) {
    e.preventDefault();
    const error = validateEmail(email);
    setEmailError(error);
    if (!error && password) void submit.run();
  }

  return (
    <div className="container narrow stack">
      <h1>Espace organisateur</h1>
      <form className="card stack" onSubmit={onSubmit} noValidate>
        <TextField
          label="E-mail"
          type="email"
          autoComplete="username"
          required
          maxLength={FIELD_LIMITS.email}
          value={email}
          error={emailError}
          onChange={(e) => setEmail(e.target.value)}
        />
        <TextField
          label="Mot de passe"
          type="password"
          autoComplete="current-password"
          required
          maxLength={FIELD_LIMITS.passwordMax}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <ErrorMessage error={submit.error} />
        <button type="submit" className="btn btn-primary btn-block" disabled={submit.pending || !password}>
          Se connecter
        </button>
      </form>
      {import.meta.env.DEV && (
        <DemoAccounts
          onPick={(mail, demoPassword) => {
            setEmail(mail);
            setPassword(demoPassword);
          }}
        />
      )}
    </div>
  );
}
