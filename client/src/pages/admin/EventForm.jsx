import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../../api.js';
import { ErrorMessage, Loading } from '../../components/common.jsx';
import { TIMEZONES, isoToZonedInput, zonedInputToIso } from '../../time.js';

const emptyType = (name = '') => ({ id: null, name, price: '', quota: '', earlyPrice: '', earlyUntil: '', earlyQuota: '', sold: 0, held: 0 });

const toEuros = (cents) => (cents == null ? '' : String(cents / 100));
const toCents = (euros) => (euros === '' || euros == null ? null : Math.round(Number(String(euros).replace(',', '.')) * 100));

export default function EventForm() {
  const { id } = useParams();
  const editing = Boolean(id);
  const navigate = useNavigate();
  const [form, setForm] = useState(null);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!editing) {
      // (5.1) Il y a toujours au moins deux types de place : le formulaire en propose deux.
      setForm({
        title: '',
        description: '',
        venue: '',
        isOnline: false,
        onlineUrl: '',
        timezone: 'Europe/Paris',
        startsAt: '',
        cancelDeadlineHours: 48,
        maxPerOrder: 6,
        types: [emptyType('Fosse'), emptyType('Balcon')],
      });
      return;
    }
    api(`/admin/events/${id}`)
      .then((e) =>
        setForm({
          title: e.title,
          description: e.description,
          venue: e.venue,
          isOnline: e.isOnline,
          onlineUrl: e.onlineUrl ?? '',
          timezone: e.timezone,
          startsAt: isoToZonedInput(e.startsAt, e.timezone),
          cancelDeadlineHours: e.cancelDeadlineHours,
          maxPerOrder: e.maxPerOrder,
          types: e.ticketTypes.map((t) => ({
            id: t.id,
            name: t.name,
            price: toEuros(t.priceCents),
            quota: String(t.quota),
            earlyPrice: toEuros(t.earlyPriceCents),
            earlyUntil: isoToZonedInput(t.earlyUntil, e.timezone),
            earlyQuota: t.earlyQuota == null ? '' : String(t.earlyQuota),
            sold: t.sold,
            held: t.held,
          })),
        }),
      )
      .catch(setError);
  }, [id, editing]);

  if (!form) return error ? <ErrorMessage error={error} /> : <Loading />;

  const set = (patch) => setForm((f) => ({ ...f, ...patch }));
  const setType = (index, patch) => set({ types: form.types.map((t, i) => (i === index ? { ...t, ...patch } : t)) });

  async function submit(e) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const body = {
        title: form.title,
        description: form.description,
        venue: form.venue,
        isOnline: form.isOnline,
        onlineUrl: form.onlineUrl,
        timezone: form.timezone,
        startsAt: zonedInputToIso(form.startsAt, form.timezone),
        cancelDeadlineHours: Number(form.cancelDeadlineHours),
        maxPerOrder: Number(form.maxPerOrder),
        ticketTypes: form.types.map((t) => ({
          id: t.id,
          name: t.name,
          priceCents: toCents(t.price),
          quota: Number(t.quota),
          earlyPriceCents: toCents(t.earlyPrice),
          earlyUntil: t.earlyUntil ? zonedInputToIso(t.earlyUntil, form.timezone) : null,
          earlyQuota: t.earlyQuota === '' ? null : Number(t.earlyQuota),
        })),
      };
      const saved = await api(editing ? `/admin/events/${id}` : '/admin/events', { method: editing ? 'PUT' : 'POST', body });
      navigate(`/admin/evenements/${saved.id}`);
    } catch (err) {
      setError(err);
      setSaving(false);
    }
  }

  return (
    <form className="stack" onSubmit={submit} style={{ maxWidth: 820 }}>
      <Link to={editing ? `/admin/evenements/${id}` : '/admin'} className="small">
        ← Retour
      </Link>
      <h1>{editing ? 'Modifier l’événement' : 'Nouvel événement'}</h1>

      <section className="card stack">
        <h2>Informations</h2>
        <label className="field">
          <span>Titre</span>
          <input required value={form.title} onChange={(e) => set({ title: e.target.value })} />
        </label>
        <label className="field">
          <span>Description</span>
          <textarea value={form.description} onChange={(e) => set({ description: e.target.value })} />
        </label>
        <label className="row">
          <input type="checkbox" checked={form.isOnline} onChange={(e) => set({ isOnline: e.target.checked })} />
          <span>Événement en ligne (lien envoyé à la place du QR code)</span>
        </label>
        {form.isOnline ? (
          <label className="field">
            <span>Lien de l’événement</span>
            <input type="url" required placeholder="https://" value={form.onlineUrl} onChange={(e) => set({ onlineUrl: e.target.value })} />
          </label>
        ) : (
          <label className="field">
            <span>Lieu</span>
            <input required value={form.venue} onChange={(e) => set({ venue: e.target.value })} />
          </label>
        )}
        <div className="form-grid two">
          <label className="field">
            <span>Date et heure de début</span>
            <input type="datetime-local" required value={form.startsAt} onChange={(e) => set({ startsAt: e.target.value })} />
          </label>
          <label className="field">
            <span>
              Fuseau horaire <span className="hint">— l’heure saisie est celle de ce fuseau</span>
            </span>
            <select value={form.timezone} onChange={(e) => set({ timezone: e.target.value })}>
              {TIMEZONES.map((tz) => (
                <option key={tz}>{tz}</option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>
              Annulation possible jusqu’à… <span className="hint">heures avant le début</span>
            </span>
            <input
              type="number"
              min="0"
              required
              value={form.cancelDeadlineHours}
              onChange={(e) => set({ cancelDeadlineHours: e.target.value })}
            />
          </label>
          <label className="field">
            <span>Places maximum par commande</span>
            <input type="number" min="1" max="50" required value={form.maxPerOrder} onChange={(e) => set({ maxPerOrder: e.target.value })} />
          </label>
        </div>
      </section>

      <section className="card stack">
        <div className="spread">
          <h2 style={{ margin: 0 }}>Types de place</h2>
          <button type="button" className="btn btn-small" onClick={() => set({ types: [...form.types, emptyType()] })}>
            + Ajouter un type
          </button>
        </div>
        <p className="small muted">
          Le tarif early s’arrête à sa date de fin, ou plus tôt si son quota est atteint. Les places early font partie du
          quota du type.
        </p>
        {form.types.map((t, i) => {
          const locked = t.sold + t.held > 0;
          return (
            <div key={t.id ?? `new-${i}`} className="type-editor stack">
              <div className="spread">
                <strong>{t.name || `Type n°${i + 1}`}</strong>
                {locked ? (
                  <span className="small muted">
                    {t.sold} vendues, {t.held} réservées
                  </span>
                ) : (
                  form.types.length > 1 && (
                    <button type="button" className="btn btn-ghost btn-small" onClick={() => set({ types: form.types.filter((_, j) => j !== i) })}>
                      Supprimer
                    </button>
                  )
                )}
              </div>
              <div className="form-grid">
                <label className="field">
                  <span>Nom</span>
                  <input required value={t.name} onChange={(e) => setType(i, { name: e.target.value })} />
                </label>
                <label className="field">
                  <span>Prix (€)</span>
                  <input required inputMode="decimal" value={t.price} onChange={(e) => setType(i, { price: e.target.value })} />
                </label>
                <label className="field">
                  <span>Quota</span>
                  <input
                    required
                    type="number"
                    min={t.sold + t.held}
                    value={t.quota}
                    onChange={(e) => setType(i, { quota: e.target.value })}
                  />
                </label>
              </div>
              <div className="form-grid">
                <label className="field">
                  <span>
                    Prix early (€) <span className="hint">optionnel</span>
                  </span>
                  <input inputMode="decimal" value={t.earlyPrice} onChange={(e) => setType(i, { earlyPrice: e.target.value })} />
                </label>
                <label className="field">
                  <span>Fin du tarif early</span>
                  <input
                    type="datetime-local"
                    value={t.earlyUntil}
                    required={t.earlyPrice !== ''}
                    onChange={(e) => setType(i, { earlyUntil: e.target.value })}
                  />
                </label>
                <label className="field">
                  <span>
                    Quota early <span className="hint">vide = illimité</span>
                  </span>
                  <input type="number" min="0" value={t.earlyQuota} onChange={(e) => setType(i, { earlyQuota: e.target.value })} />
                </label>
              </div>
            </div>
          );
        })}
      </section>

      <ErrorMessage error={error} />
      <div className="row">
        <button className="btn btn-primary btn-large" disabled={saving}>
          {editing ? 'Enregistrer' : 'Créer le brouillon'}
        </button>
        {!editing && <span className="small muted">L’événement sera visible du public une fois publié.</span>}
      </div>
    </form>
  );
}
