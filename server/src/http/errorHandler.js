import { HttpError } from '../errors.js';

// Aucune erreur technique (SQL, pile d'appels…) n'est renvoyée au navigateur :
// le détail reste dans les journaux du serveur, l'utilisateur reçoit un message clair.
// Express reconnaît un gestionnaire d’erreurs à ses quatre paramètres (_next est donc requis).
export function errorHandler(err, _req, res, _next) {
  if (err instanceof HttpError) {
    return res.status(err.status).json({ error: err.code, message: err.message, ...err.extra });
  }
  if (err?.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'invalid_json', message: 'Requête invalide.' });
  }
  if (err?.type === 'entity.too.large') {
    return res.status(413).json({ error: 'payload_too_large', message: 'Requête trop volumineuse.' });
  }
  console.error(err);
  return res.status(500).json({ error: 'server_error', message: 'Erreur interne, réessayez.' });
}

export function apiNotFound(_req, res) {
  res.status(404).json({ error: 'not_found', message: 'Ressource introuvable.' });
}
