// Comptes de la base de démonstration. Ce composant n'est affiché qu'en développement
// (import.meta.env.DEV) : Vite le retire du build de production, le mot de passe de démo
// n'est donc jamais publié. Ces comptes n'existent pas sur une base de production.
const DEMO_PASSWORD = 'demo1234';

const DEMO_ACCOUNTS = [
  ['admin@nuits.test', 'Admin — Les Nuits de la Garonne'],
  ['controle@nuits.test', 'Contrôleur — Les Nuits de la Garonne'],
  ['admin@bassins.test', 'Admin — Collectif Bassins'],
  ['admin@ondes.test', 'Admin — Ondes Lointaines'],
  ['super@tickekette.test', 'Super-admin de la plateforme'],
] as const;

export function DemoAccounts({ onPick }: { onPick: (email: string, password: string) => void }) {
  return (
    <section className="card stack" aria-labelledby="demo-title">
      <h2 id="demo-title">Comptes de démonstration</h2>
      <p className="small muted">Environnement de développement uniquement. Cliquez pour préremplir.</p>
      <ul className="plain-list stack-tight">
        {DEMO_ACCOUNTS.map(([email, label]) => (
          <li key={email}>
            <button type="button" className="btn btn-small btn-block spread-button" onClick={() => onPick(email, DEMO_PASSWORD)}>
              <span>{label}</span>
              <span className="mono muted">{email}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
