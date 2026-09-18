import { Link } from 'react-router-dom';

export default function NotFound() {
  return (
    <div className="container narrow stack">
      <h1>Page introuvable</h1>
      <p className="muted">Le lien est peut-être incomplet.</p>
      <Link to="/" className="btn">
        Voir les événements
      </Link>
    </div>
  );
}
