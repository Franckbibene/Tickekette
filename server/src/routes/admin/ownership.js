import { get } from '../../db.js';
import { notFound } from '../../errors.js';
import { routeId } from '../../validation.js';

// Contrôle d'accès aux événements : le collectif vient du compte connecté (req.user),
// jamais de la requête. Un événement d'un autre collectif répond « introuvable »,
// comme s'il n'existait pas : changer l'identifiant dans l'URL ne donne accès à rien (IDOR).
export function ownEvent(req) {
  const event = get('SELECT * FROM events WHERE id = ? AND collective_id = ?', routeId(req.params.id), req.user.collective_id);
  if (!event) throw notFound('Événement introuvable.');
  return event;
}
