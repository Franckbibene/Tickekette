import { useState, type SubmitEvent } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { ErrorMessage } from '../../components/common/Feedback';
import { TextField } from '../../components/forms/Field';
import { useAsyncAction } from '../../hooks/useAsyncAction';
import { useAuth } from '../../hooks/useAuth';
import type { MfaChallenge, MfaSetup, User } from '../../types/api';
import { homeFor } from '../../routes/paths';
import { FIELD_LIMITS, validateEmail } from '../../utils/validation';
import { safeInternalPath } from '../../utils/url';
import { DemoAccounts } from './DemoAccounts';

export default function LoginPage() {
  const { user, login, mfaSetup, confirmMfa } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [otp, setOtp] = useState('');
  const [challenge, setChallenge] = useState<MfaChallenge | null>(null);
  const [setup, setSetup] = useState<MfaSetup | null>(null);
  const [emailError, setEmailError] = useState<string>();
  const finish = (u: User) => {
    // Retour à la page demandée avant la connexion : chemin interne uniquement (pas d'open redirect).
    const from = safeInternalPath((location.state as { from?: unknown } | null)?.from, homeFor(u.role));
    void navigate(from === '/connexion' ? homeFor(u.role) : from, { replace: true });
  };
  const submit = useAsyncAction(async () => {
    if (challenge?.setupRequired) {
      finish(await confirmMfa(otp));
      return;
    }
    const result = challenge ? await login(email.trim(), password, otp) : await login(email.trim(), password);
    if ('mfaRequired' in result) {
      setChallenge(result);
      if (result.setupRequired) setSetup(await mfaSetup());
      return;
    }
    finish(result);
  });

  if (user) return <Navigate to={homeFor(user.role)} replace />;

  function onSubmit(e: SubmitEvent<HTMLFormElement>) {
    e.preventDefault();
    const error = validateEmail(email);
    setEmailError(error);
    if (!error && password && (!challenge || otp.length === 6)) void submit.run();
  }

  return (
    <div className="container narrow stack">
      <h1>Espace organisateur</h1>
      <form className="card stack" onSubmit={onSubmit} noValidate>
        {!challenge && (
          <>
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
          </>
        )}
        {challenge && (
          <div className="stack">
            <h2>{challenge.setupRequired ? 'Configurer la double authentification' : 'Double authentification'}</h2>
            {setup && (
              <>
                <p className="muted">
                  Scannez ce QR code dans votre application d’authentification, puis saisissez le code à six chiffres.
                </p>
                <div className="qr">
                  <QRCodeSVG value={setup.uri} size={200} level="M" />
                </div>
                <p className="small mono">Clé manuelle : {setup.secret}</p>
              </>
            )}
            <TextField
              label="Code à six chiffres"
              inputMode="numeric"
              autoComplete="one-time-code"
              required
              maxLength={6}
              value={otp}
              onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
            />
          </div>
        )}
        <ErrorMessage error={submit.error} />
        <button
          type="submit"
          className="btn btn-primary btn-block"
          disabled={submit.pending || !password || (challenge !== null && otp.length !== 6)}
        >
          {challenge?.setupRequired ? 'Activer et se connecter' : challenge ? 'Vérifier le code' : 'Se connecter'}
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
