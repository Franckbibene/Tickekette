import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { config } from './config.js';
import { get } from './db.js';
import { HttpError } from './errors.js';

export const hashPassword = (password) => bcrypt.hashSync(password, 10);
export const checkPassword = (password, hash) => bcrypt.compareSync(password, hash);

export function signToken(user) {
  return jwt.sign({ uid: user.id }, config.jwtSecret, { expiresIn: '14h' });
}

export function publicUser(user) {
  const collective = user.collective_id
    ? get('SELECT id, name, slug, color FROM collectives WHERE id = ?', user.collective_id)
    : null;
  return { id: user.id, name: user.name, email: user.email, role: user.role, collective };
}

// Vérifie le jeton et le rôle. Le collectif vient toujours de la base, jamais de la requête :
// c'est ce qui garantit qu'un collectif ne voit que ses propres données (4.1).
export function requireAuth(...roles) {
  return (req, _res, next) => {
    const header = req.get('authorization') || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) throw new HttpError(401, 'unauthenticated', 'Connexion requise.');
    let payload;
    try {
      payload = jwt.verify(token, config.jwtSecret);
    } catch {
      throw new HttpError(401, 'unauthenticated', 'Session expirée, reconnectez-vous.');
    }
    const user = get('SELECT id, name, email, role, collective_id FROM users WHERE id = ?', payload.uid);
    if (!user) throw new HttpError(401, 'unauthenticated', 'Compte introuvable.');
    if (roles.length && !roles.includes(user.role)) {
      throw new HttpError(403, 'forbidden', "Vous n'avez pas accès à cette page.");
    }
    req.user = user;
    next();
  };
}
