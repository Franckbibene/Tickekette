import { useState, type SubmitEvent } from 'react';
import { adminApi } from '../../api/admin';
import { ErrorMessage } from '../../components/common/Feedback';
import { QueryView } from '../../components/common/QueryView';
import { SelectField, TextField } from '../../components/forms/Field';
import { useApiQuery } from '../../hooks/useApiQuery';
import { useAsyncAction } from '../../hooks/useAsyncAction';
import { useAuth } from '../../hooks/useAuth';
import type { TeamMember, TeamMemberInput } from '../../types/api';
import { FIELD_LIMITS, hasErrors, validateEmail, validateName, validatePassword, type FieldErrors } from '../../utils/validation';

const ROLE_OPTIONS: Record<TeamMemberInput['role'], string> = {
  controller: 'Contrôleur : scan des billets uniquement, aucun chiffre',
  admin: 'Admin : événements, chiffres, exports, équipe',
};

const EMPTY_MEMBER: TeamMemberInput = { name: '', email: '', password: '', role: 'controller' };

const isRole = (value: string): value is TeamMemberInput['role'] => value in ROLE_OPTIONS;

export default function TeamPage() {
  const { user } = useAuth();
  const team = useApiQuery('admin:team', (signal) => adminApi.team(signal));
  const [form, setForm] = useState(EMPTY_MEMBER);
  const [errors, setErrors] = useState<FieldErrors<'name' | 'email' | 'password'>>({});
  const add = useAsyncAction(async (input: TeamMemberInput) => {
    await adminApi.addTeamMember(input);
    setForm(EMPTY_MEMBER);
    team.reload();
  });
  const remove = useAsyncAction(async (member: TeamMember) => {
    await adminApi.removeTeamMember(member.id);
    team.reload();
  });

  function submit(e: SubmitEvent<HTMLFormElement>) {
    e.preventDefault();
    const next = { name: validateName(form.name), email: validateEmail(form.email), password: validatePassword(form.password) };
    setErrors(next);
    if (!hasErrors(next)) void add.run({ ...form, name: form.name.trim(), email: form.email.trim() });
  }

  return (
    <div className="stack form-page">
      <h1>Équipe — {user?.collective?.name}</h1>
      <ErrorMessage error={remove.error} />
      <QueryView query={team}>
        {(members) => (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th scope="col">Nom</th>
                  <th scope="col">Rôle</th>
                  <th scope="col">
                    <span className="visually-hidden">Action</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {members.map((m) => (
                  <tr key={m.id}>
                    <td>
                      {m.name}
                      <div className="small muted">{m.email}</div>
                    </td>
                    <td>
                      <span className={`badge ${m.role === 'admin' ? 'badge-accent' : ''}`}>
                        {m.role === 'admin' ? 'Admin' : 'Contrôleur'}
                      </span>
                    </td>
                    <td className="num">
                      {m.id !== user?.id && (
                        <button
                          type="button"
                          className="btn btn-small btn-ghost"
                          disabled={remove.pending}
                          onClick={() => {
                            if (window.confirm(`Supprimer le compte de ${m.name} ?`)) void remove.run(m);
                          }}
                        >
                          Supprimer<span className="visually-hidden"> {m.name}</span>
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </QueryView>

      <form className="card stack" onSubmit={submit} noValidate>
        <h2>Ajouter une personne</h2>
        <div className="form-grid two">
          <TextField
            label="Nom"
            required
            maxLength={FIELD_LIMITS.name}
            value={form.name}
            error={errors.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
          />
          <TextField
            label="E-mail"
            type="email"
            required
            maxLength={FIELD_LIMITS.email}
            value={form.email}
            error={errors.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
          />
          <TextField
            label="Mot de passe provisoire"
            hint={`${FIELD_LIMITS.passwordMin} caractères minimum`}
            type="password"
            autoComplete="new-password"
            required
            maxLength={FIELD_LIMITS.passwordMax}
            value={form.password}
            error={errors.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })}
          />
          <SelectField
            label="Rôle"
            value={form.role}
            onChange={(e) => isRole(e.target.value) && setForm({ ...form, role: e.target.value })}
          >
            {Object.entries(ROLE_OPTIONS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </SelectField>
        </div>
        <ErrorMessage error={add.error} />
        <div>
          <button type="submit" className="btn btn-primary" disabled={add.pending}>
            Ajouter
          </button>
        </div>
      </form>
    </div>
  );
}
