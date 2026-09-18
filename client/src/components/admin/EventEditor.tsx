import { useState, type SubmitEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { adminApi } from '../../api/admin';
import { useAsyncAction } from '../../hooks/useAsyncAction';
import {
  hasEventFormErrors,
  newTicketTypeDraft,
  toEventInput,
  validateEventForm,
  type EventFormErrors,
  type EventFormState,
  type TicketTypeDraft,
} from '../../utils/eventForm';
import { TIMEZONES } from '../../utils/timezones';
import { FIELD_LIMITS } from '../../utils/validation';
import { ErrorMessage } from '../common/Feedback';
import { SelectField, TextAreaField, TextField } from '../forms/Field';
import { TicketTypeFields } from './TicketTypeFields';

// Formulaire de création / modification. La validation ici sert le confort de saisie ;
// le serveur revalide tout (types, bornes, dates, URL) avant d'enregistrer.
export function EventEditor({ eventId, initial }: { eventId: number | null; initial: () => EventFormState }) {
  const navigate = useNavigate();
  const [form, setForm] = useState(initial);
  const [errors, setErrors] = useState<EventFormErrors>({});
  const save = useAsyncAction(async () => {
    const input = toEventInput(form);
    const saved = eventId === null ? await adminApi.createEvent(input) : await adminApi.updateEvent(eventId, input);
    void navigate(`/admin/evenements/${saved.id}`);
  });

  const set = (patch: Partial<EventFormState>) => setForm((f) => ({ ...f, ...patch }));
  const setType = (uid: string, patch: Partial<TicketTypeDraft>) =>
    setForm((f) => ({ ...f, types: f.types.map((t) => (t.uid === uid ? { ...t, ...patch } : t)) }));

  function submit(e: SubmitEvent<HTMLFormElement>) {
    e.preventDefault();
    const next = validateEventForm(form, { requireFuture: eventId === null, now: new Date() });
    setErrors(next);
    if (!hasEventFormErrors(next)) void save.run();
  }

  return (
    <form className="stack form-page" onSubmit={submit} noValidate>
      <Link to={eventId === null ? '/admin' : `/admin/evenements/${eventId}`} className="small">
        ← Retour
      </Link>
      <h1>{eventId === null ? 'Nouvel événement' : 'Modifier l’événement'}</h1>

      <section className="card stack">
        <h2>Informations</h2>
        <TextField
          label="Titre"
          required
          maxLength={FIELD_LIMITS.title}
          value={form.title}
          error={errors.title}
          onChange={(e) => set({ title: e.target.value })}
        />
        <TextAreaField
          label="Description"
          maxLength={FIELD_LIMITS.description}
          value={form.description}
          onChange={(e) => set({ description: e.target.value })}
        />
        <label className="row checkbox-row">
          <input type="checkbox" checked={form.isOnline} onChange={(e) => set({ isOnline: e.target.checked })} />
          <span>Événement en ligne (lien envoyé à la place du QR code)</span>
        </label>
        {form.isOnline ? (
          <TextField
            label="Lien de l’événement"
            type="url"
            required
            placeholder="https://"
            maxLength={FIELD_LIMITS.url}
            value={form.onlineUrl}
            error={errors.onlineUrl}
            onChange={(e) => set({ onlineUrl: e.target.value })}
          />
        ) : (
          <TextField
            label="Lieu"
            required
            maxLength={FIELD_LIMITS.venue}
            value={form.venue}
            error={errors.venue}
            onChange={(e) => set({ venue: e.target.value })}
          />
        )}
        <div className="form-grid two">
          <TextField
            label="Date et heure de début"
            type="datetime-local"
            required
            value={form.startsAt}
            error={errors.startsAt}
            onChange={(e) => set({ startsAt: e.target.value })}
          />
          <SelectField
            label="Fuseau horaire"
            hint="L’heure saisie est celle de ce fuseau."
            value={form.timezone}
            onChange={(e) => set({ timezone: e.target.value })}
          >
            {TIMEZONES.map((tz) => (
              <option key={tz}>{tz}</option>
            ))}
          </SelectField>
          <TextField
            label="Annulation possible jusqu’à… (heures avant le début)"
            type="number"
            min={0}
            max={FIELD_LIMITS.cancelDeadlineHoursMax}
            required
            value={form.cancelDeadlineHours}
            error={errors.cancelDeadlineHours}
            onChange={(e) => set({ cancelDeadlineHours: e.target.value })}
          />
          <TextField
            label="Places maximum par commande"
            type="number"
            min={1}
            max={FIELD_LIMITS.maxPerOrderMax}
            required
            value={form.maxPerOrder}
            error={errors.maxPerOrder}
            onChange={(e) => set({ maxPerOrder: e.target.value })}
          />
        </div>
      </section>

      <section className="card stack">
        <div className="spread">
          <h2 className="no-margin">Types de place</h2>
          <button type="button" className="btn btn-small" onClick={() => set({ types: [...form.types, newTicketTypeDraft()] })}>
            + Ajouter un type
          </button>
        </div>
        <p className="small muted">
          Le tarif early s’arrête à sa date de fin, ou plus tôt si son quota est atteint. Les places early font partie du quota du type.
        </p>
        {form.types.map((draft, index) => (
          <TicketTypeFields
            key={draft.uid}
            draft={draft}
            index={index}
            error={errors.types?.[draft.uid]}
            canRemove={form.types.length > 1}
            onChange={(patch) => setType(draft.uid, patch)}
            onRemove={() => set({ types: form.types.filter((t) => t.uid !== draft.uid) })}
          />
        ))}
      </section>

      {hasEventFormErrors(errors) && (
        <div className="alert alert-error" role="alert">
          Certains champs sont à corriger.
        </div>
      )}
      <ErrorMessage error={save.error} />
      <div className="row">
        <button type="submit" className="btn btn-primary btn-large" disabled={save.pending}>
          {eventId === null ? 'Créer le brouillon' : 'Enregistrer'}
        </button>
        {eventId === null && <span className="small muted">L’événement sera visible du public une fois publié.</span>}
      </div>
    </form>
  );
}
