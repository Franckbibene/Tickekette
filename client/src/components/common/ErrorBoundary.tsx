import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
  // Change de valeur à chaque navigation : l'erreur est oubliée en changeant de page.
  resetKey?: string;
}

interface State {
  failed: boolean;
  resetKey?: string;
}

// Filet de sécurité : une erreur dans un composant affiche un message clair
// au lieu d'une page blanche. Le détail technique n'est affiché qu'en développement.
export class ErrorBoundary extends Component<Props, State> {
  override state: State = { failed: false, resetKey: this.props.resetKey };

  static getDerivedStateFromError(): Partial<State> {
    return { failed: true };
  }

  static getDerivedStateFromProps(props: Props, state: State): Partial<State> | null {
    return props.resetKey !== state.resetKey ? { failed: false, resetKey: props.resetKey } : null;
  }

  override componentDidCatch(error: Error, info: ErrorInfo) {
    if (import.meta.env.DEV) console.error(error, info.componentStack);
  }

  override render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="container narrow stack" role="alert">
        <h1>Oups, un problème est survenu</h1>
        <p className="muted">Cette page n’a pas pu s’afficher. Rechargez-la ou revenez à l’accueil.</p>
        <div className="row">
          <button type="button" className="btn btn-primary" onClick={() => window.location.reload()}>
            Recharger la page
          </button>
          <a className="btn" href="/">
            Accueil
          </a>
        </div>
      </div>
    );
  }
}
