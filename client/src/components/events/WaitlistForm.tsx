import { useState, type SubmitEvent } from 'react';
import { eventsApi } from '../../api/events';
import { useAsyncAction } from '../../hooks/useAsyncAction';
import { useLang } from '../../hooks/useLang';
import type { EventDetail, PublicTicketType } from '../../types/api';
import { FIELD_LIMITS, hasErrors, validateEmail, validateName, type FieldErrors } from '../../utils/validation';
import { ErrorMessage } from '../common/Feedback';
import { SelectField, TextField } from '../forms/Field';

interface Props {
  event: EventDetail;
  ticketType: PublicTicketType;
  onClose: () => void;
}

// Formulaire autonome (hors du formulaire d'achat : pas de <form> imbriqué).
export function WaitlistForm({ event, ticketType, onClose }: Props) {
  const { t, lang } = useLang();
  const [form, setForm] = useState({ name: '', email: '', quantity: 1 });
  const [errors, setErrors] = useState<FieldErrors<'name' | 'email'>>({});
  const join = useAsyncAction(() =>
    eventsApi.joinWaitlist(event.id, {
      ticketTypeId: ticketType.id,
      name: form.name.trim(),
      email: form.email.trim(),
      quantity: form.quantity,
      locale: lang,
    }),
  );
  const [done, setDone] = useState(false);

  if (done) return <div className="alert alert-success">{t('waitlist.done')}</div>;

  async function submit(e: SubmitEvent<HTMLFormElement>) {
    e.preventDefault();
    const next = { name: validateName(form.name), email: validateEmail(form.email) };
    setErrors(next);
    if (hasErrors(next)) return;
    const result = await join.run();
    if (result) setDone(true);
  }

  return (
    <form className="card card-tight stack waitlist-form" onSubmit={(e) => void submit(e)} noValidate>
      <h3>{t('waitlist.title', { name: ticketType.name })}</h3>
      <p className="small muted">{t('waitlist.explain')}</p>
      {ticketType.waitlistCount > 0 && <p className="small">{t('event.waitlistCount', { n: ticketType.waitlistCount })}</p>}
      <TextField
        label={t('event.name')}
        required
        autoComplete="name"
        maxLength={FIELD_LIMITS.name}
        value={form.name}
        error={errors.name}
        onChange={(e) => setForm({ ...form, name: e.target.value })}
      />
      <TextField
        label="E-mail"
        type="email"
        required
        autoComplete="email"
        maxLength={FIELD_LIMITS.email}
        value={form.email}
        error={errors.email}
        onChange={(e) => setForm({ ...form, email: e.target.value })}
      />
      <SelectField
        label={t('waitlist.quantity')}
        value={form.quantity}
        onChange={(e) => setForm({ ...form, quantity: Number(e.target.value) })}
      >
        {Array.from({ length: event.maxPerOrder }, (_, i) => i + 1).map((n) => (
          <option key={n} value={n}>
            {n}
          </option>
        ))}
      </SelectField>
      <ErrorMessage error={join.error} />
      <div className="row">
        <button type="submit" className="btn btn-primary" disabled={join.pending}>
          {t('waitlist.submit')}
        </button>
        <button type="button" className="btn btn-ghost" onClick={onClose}>
          {t('common.cancel')}
        </button>
      </div>
    </form>
  );
}
