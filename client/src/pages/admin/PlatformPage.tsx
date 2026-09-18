import { useState, type SubmitEvent } from 'react';
import { platformApi } from '../../api/platform';
import { ErrorMessage } from '../../components/common/Feedback';
import { QueryView } from '../../components/common/QueryView';
import { TextField } from '../../components/forms/Field';
import { useApiQuery } from '../../hooks/useApiQuery';
import { useAsyncAction } from '../../hooks/useAsyncAction';
import type { CollectiveInput } from '../../types/api';
import { FIELD_LIMITS, hasErrors, validateEmail, validateName, validatePassword, type FieldErrors } from '../../utils/validation';

const EMPTY: CollectiveInput = { name: '', slug: '', color: '#9a3412', iban: '', adminName: '', adminEmail: '', adminPassword: '' };
const SLUG_RE = /^[a-z0-9-]{2,40}$/;
const IBAN_MAX = 42;

const slugify = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40);

type Errors = FieldErrors<'name' | 'slug' | 'adminName' | 'adminEmail' | 'adminPassword'>;

// Super-administration : gestion des collectifs, sans aucun accès aux chiffres de vente (H2).
export default function PlatformPage() {
  const collectives = useApiQuery('platform:collectives', (signal) => platformApi.collectives(signal));
  const [form, setForm] = useState(EMPTY);
  const [errors, setErrors] = useState<Errors>({});
  const [created, setCreated] = useState<string | null>(null);
  const create = useAsyncAction(async (input: CollectiveInput) => {
    const c = await platformApi.createCollective(input);
    setCreated(`Collectif « ${c.name} » créé. ${input.adminEmail} peut se connecter.`);
    setForm(EMPTY);
    collectives.reload();
  });

  function submit(e: SubmitEvent<HTMLFormElement>) {
    e.preventDefault();
    setCreated(null);
    const next: Errors = {
      name: validateName(form.name),
      slug: SLUG_RE.test(form.slug) ? undefined : '2 à 40 lettres minuscules, chiffres ou tirets.',
      adminName: validateName(form.adminName),
      adminEmail: validateEmail(form.adminEmail),
      adminPassword: validatePassword(form.adminPassword),
    };
    setErrors(next);
    if (!hasErrors(next))
      void create.run({ ...form, name: form.name.trim(), adminName: form.adminName.trim(), adminEmail: form.adminEmail.trim() });
  }

  return (
    <div className="stack form-page">
      <h1>Collectifs</h1>
      <p className="muted">
        Chaque collectif gère ses événements et ne voit que ses propres données. En tant que plateforme, vous n’avez pas accès à leurs
        chiffres de vente.
      </p>
      <QueryView query={collectives} empty="Aucun collectif.">
        {(list) => (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th scope="col">Collectif</th>
                  <th scope="col">Page publique</th>
                  <th scope="col" className="num">
                    Événements
                  </th>
                  <th scope="col" className="num">
                    Comptes
                  </th>
                </tr>
              </thead>
              <tbody>
                {list.map((c) => (
                  <tr key={c.id}>
                    <td>
                      <span className="row">
                        <span className="collective-dot" style={{ background: c.color }} />
                        {c.name}
                      </span>
                    </td>
                    <td>
                      <a href={`/c/${encodeURIComponent(c.slug)}`} className="mono small">
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
      </QueryView>

      <form className="card stack" onSubmit={submit} noValidate>
        <h2>Ajouter un collectif</h2>
        <div className="form-grid two">
          <TextField
            label="Nom du collectif"
            required
            maxLength={FIELD_LIMITS.name}
            value={form.name}
            error={errors.name}
            onChange={(e) => setForm({ ...form, name: e.target.value, slug: slugify(e.target.value) })}
          />
          <TextField
            label="Identifiant"
            hint="Adresse de la page publique"
            required
            maxLength={40}
            value={form.slug}
            error={errors.slug}
            onChange={(e) => setForm({ ...form, slug: e.target.value.toLowerCase() })}
          />
          <TextField label="Couleur" type="color" value={form.color} onChange={(e) => setForm({ ...form, color: e.target.value })} />
          <TextField
            label="IBAN"
            hint="Pour les paiements par virement"
            maxLength={IBAN_MAX}
            value={form.iban}
            onChange={(e) => setForm({ ...form, iban: e.target.value })}
          />
          <TextField
            label="Nom du premier admin"
            required
            maxLength={FIELD_LIMITS.name}
            value={form.adminName}
            error={errors.adminName}
            onChange={(e) => setForm({ ...form, adminName: e.target.value })}
          />
          <TextField
            label="E-mail du premier admin"
            type="email"
            required
            maxLength={FIELD_LIMITS.email}
            value={form.adminEmail}
            error={errors.adminEmail}
            onChange={(e) => setForm({ ...form, adminEmail: e.target.value })}
          />
          <TextField
            label="Mot de passe provisoire"
            type="password"
            autoComplete="new-password"
            required
            maxLength={FIELD_LIMITS.passwordMax}
            value={form.adminPassword}
            error={errors.adminPassword}
            onChange={(e) => setForm({ ...form, adminPassword: e.target.value })}
          />
        </div>
        <ErrorMessage error={create.error} />
        {created && (
          <div className="alert alert-success" role="status">
            {created}
          </div>
        )}
        <div>
          <button type="submit" className="btn btn-primary" disabled={create.pending}>
            Créer le collectif
          </button>
        </div>
      </form>
    </div>
  );
}
