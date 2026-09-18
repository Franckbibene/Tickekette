import { useState } from 'react';
import { api } from '../../api.js';
import { useAuth } from '../../auth.jsx';
import { ErrorMessage, Loading, useResource } from '../../components/common.jsx';

const ROLES = {
  admin: 'Admin : événements, chiffres, exports, équipe',
  controller: 'Contrôleur : scan des billets uniquement, aucun chiffre',
};

export default function Team() {
  const { user } = useAuth();
  const { data: users, error, reload } = useResource(() => api('/admin/users'), []);
  const [form, setForm] = useState({ name: '', email: '', password: '', role: 'controller' });
  const [formError, setFormError] = useState(null);
  const [busy, setBusy] = useState(false);

  async function add(e) {
    e.preventDefault();
    setBusy(true);
    setFormError(null);
    try {
      await api('/admin/users', { method: 'POST', body: form });
      setForm({ name: '', email: '', password: '', role: 'controller' });
      reload();
    } catch (err) {
      setFormError(err);
    } finally {
      setBusy(false);
    }
  }

  async function remove(u) {
    if (!window.confirm(`Supprimer le compte de ${u.name} ?`)) return;
    try {
      await api(`/admin/users/${u.id}`, { method: 'DELETE' });
      reload();
    } catch (err) {
      setFormError(err);
    }
  }

  return (
    <div className="stack" style={{ maxWidth: 820 }}>
      <h1>Équipe — {user.collective?.name}</h1>
      <ErrorMessage error={error} />
      {!users && !error && <Loading />}
      {users && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Nom</th>
                <th>Rôle</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id}>
                  <td>
                    {u.name}
                    <div className="small muted">{u.email}</div>
                  </td>
                  <td>
                    <span className={`badge ${u.role === 'admin' ? 'badge-accent' : ''}`}>{u.role === 'admin' ? 'Admin' : 'Contrôleur'}</span>
                  </td>
                  <td className="num">
                    {u.id !== user.id && (
                      <button className="btn btn-small btn-ghost" onClick={() => remove(u)}>
                        Supprimer
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <form className="card stack" onSubmit={add}>
        <h2>Ajouter une personne</h2>
        <div className="form-grid two">
          <label className="field">
            <span>Nom</span>
            <input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </label>
          <label className="field">
            <span>E-mail</span>
            <input type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          </label>
          <label className="field">
            <span>
              Mot de passe provisoire <span className="hint">8 caractères minimum</span>
            </span>
            <input
              type="password"
              autoComplete="new-password"
              minLength={8}
              required
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
            />
          </label>
          <label className="field">
            <span>Rôle</span>
            <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
              {Object.entries(ROLES).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <ErrorMessage error={formError} />
        <div>
          <button className="btn btn-primary" disabled={busy}>
            Ajouter
          </button>
        </div>
      </form>
    </div>
  );
}
