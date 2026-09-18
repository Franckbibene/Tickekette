import { Router } from 'express';
import { all, get, run, tx } from '../../db.js';
import { clock } from '../../clock.js';
import { hashPassword } from '../../auth.js';
import { badRequest, conflict, notFound } from '../../errors.js';
import { LIMITS, email, oneOf, password, routeId, text } from '../../validation.js';

const TEAM_ROLES = ['admin', 'controller'];

// Équipe du collectif (3.5). Un admin ne gère que les comptes de son collectif
// et ne peut créer que des admins ou des contrôleurs (jamais un super-admin).
export const teamRouter = Router();

teamRouter.get('/users', (req, res) => {
  res.json(
    all(
      'SELECT id, name, email, role, created_at AS createdAt FROM users WHERE collective_id = ? ORDER BY role, name',
      req.user.collective_id,
    ),
  );
});

teamRouter.post('/users', (req, res) => {
  const b = req.body ?? {};
  const input = {
    name: text(b.name, { field: 'Nom', max: LIMITS.name }),
    email: email(b.email),
    password: password(b.password),
    role: oneOf(b.role ?? 'controller', TEAM_ROLES, 'Rôle'),
  };
  if (get('SELECT id FROM users WHERE email = ?', input.email)) throw conflict('email_taken', 'Cet e-mail est déjà utilisé.');
  const { lastInsertRowid } = run(
    'INSERT INTO users (collective_id, email, password_hash, name, role, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    req.user.collective_id,
    input.email,
    hashPassword(input.password),
    input.name,
    input.role,
    clock.nowIso(),
  );
  res.status(201).json(get('SELECT id, name, email, role FROM users WHERE id = ?', Number(lastInsertRowid)));
});

teamRouter.delete('/users/:id', (req, res) => {
  const id = routeId(req.params.id);
  if (id === req.user.id) throw badRequest('self_delete', 'Vous ne pouvez pas supprimer votre propre compte.');
  const user = get('SELECT id FROM users WHERE id = ? AND collective_id = ?', id, req.user.collective_id);
  if (!user) throw notFound('Utilisateur introuvable.');
  tx(() => {
    run('UPDATE scans SET user_id = NULL WHERE user_id = ?', id);
    run('DELETE FROM users WHERE id = ?', id);
  });
  res.status(204).end();
});
