import { useState } from 'react';
import { api } from '../../api.js';
import { ErrorMessage, Loading, useResource } from '../../components/common.jsx';

const empty = { name: '', slug: '', color: '#9a3412', iban: '', adminName: '', adminEmail: '', adminPassword: '' };
const slugify = (s) =>
  s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

// Super-administration : gestion des collectifs, sans aucun accès aux chiffres de vente (H2).
export default function Platform() {
  const { data: collectives, error, reload } = useResource(() => api('/platform/collectives'), []);
  const [form, setForm] = useState(empty);
  const [formError, setFormError] = useState(null);
  const [done, setDone] = useState(null);

  async function submit(e) {
    e.preventDefault();
    setFormError(null);
    setDone(null);
    try {
      const c = await api('/platform/collectives', { method: 'POST', body: form });
      setDone(`Collectif « ${c.name} » créé. ${form.adminEmail} peut se connecter.`);
      setForm(empty);
      reload();
    } catch (err) {
      setFormError(err);
    }
  }

  return (
    <div className="stack" style={{ maxWidth: 900 }}>
      <h1>Collectifs</h1>
      <p className="muted">
        Chaque collectif gère ses événements et ne voit que ses propres données. En tant que plateforme, vous n’avez pas
        accès à leurs chiffres de vente.
      </p>
      <ErrorMessage error={error} />
      {!collectives && !error && <Loading />}
      {collectives && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Collectif</th>
                <th>Page publique</th>
                <th className="num">Événements</th>
                <th className="num">Comptes</th>
              </tr>
            </thead>
            <tbody>
              {collectives.map((c) => (
                <tr key={c.id}>
                  <td>
                    <span className="row">
                      <span className="collective-dot" style={{ background: c.color }} />
                      {c.name}
                    </span>
                  </td>
                  <td>
                    <a href={`/c/${c.slug}`} target="_blank" rel="noreferrer" className="mono small">
                      /c/{c.slug}
                    </a>
                  </td>
                  <td className="num">{c.eventsCount}</td>
                  <td className="num">{c.usersCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <form className="card stack" onSubmit={submit}>
        <h2>Ajouter un collectif</h2>
        <div className="form-grid two">
          <label className="field">
            <span>Nom du collectif</span>
            <input
              required
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value, slug: slugify(e.target.value) })}
            />
          </label>
          <label className="field">
            <span>
              Identifiant <span className="hint">adresse de la page publique</span>
            </span>
            <input required pattern="[a-z0-9-]{2,40}" value={form.slug} onChange={(e) => setForm({ ...form, slug: e.target.value })} />
          </label>
          <label className="field">
            <span>Couleur</span>
            <input type="color" value={form.color} onChange={(e) => setForm({ ...form, color: e.target.value })} style={{ padding: 4 }} />
          </label>
          <label className="field">
            <span>
              IBAN <span className="hint">pour les paiements par virement</span>
            </span>
            <input value={form.iban} onChange={(e) => setForm({ ...form, iban: e.target.value })} />
          </label>
          <label className="field">
            <span>Nom du premier admin</span>
            <input required value={form.adminName} onChange={(e) => setForm({ ...form, adminName: e.target.value })} />
          </label>
          <label className="field">
            <span>E-mail du premier admin</span>
            <input type="email" required value={form.adminEmail} onChange={(e) => setForm({ ...form, adminEmail: e.target.value })} />
          </label>
          <label className="field">
            <span>Mot de passe provisoire</span>
            <input
              type="password"
              autoComplete="new-password"
              minLength={8}
              required
              value={form.adminPassword}
              onChange={(e) => setForm({ ...form, adminPassword: e.target.value })}
            />
          </label>
        </div>
        <ErrorMessage error={formError} />
        {done && <div className="alert alert-success">{done}</div>}
        <div>
          <button className="btn btn-primary">Créer le collectif</button>
        </div>
      </form>
    </div>
  );
}
