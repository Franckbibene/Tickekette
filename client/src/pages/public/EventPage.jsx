import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../../api.js';
import { ErrorMessage, EventTime, Loading, useResource } from '../../components/common.jsx';
import { useLang } from '../../i18n.jsx';
import { formatMoney, formatShort } from '../../time.js';

const effectivePrice = (tt) => tt.earlyPriceCents ?? tt.priceCents;

export default function EventPage() {
  const { id } = useParams();
  const { t, lang } = useLang();
  const navigate = useNavigate();
  const { data: event, error: loadError, reload } = useResource(() => api(`/events/${id}`), [id]);
  const [quantities, setQuantities] = useState({});
  const [buyer, setBuyer] = useState({ buyerName: '', buyerEmail: '' });
  const [paymentMethod, setPaymentMethod] = useState('card');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [waitlistFor, setWaitlistFor] = useState(null);

  if (loadError) {
    return (
      <div className="container narrow">
        <ErrorMessage error={loadError} />
        <Link to="/">← {t('nav.events')}</Link>
      </div>
    );
  }
  if (!event) {
    return (
      <div className="container">
        <Loading />
      </div>
    );
  }

  const totalQty = Object.values(quantities).reduce((s, q) => s + q, 0);
  const totalCents = event.ticketTypes.reduce((s, tt) => s + (quantities[tt.id] ?? 0) * effectivePrice(tt), 0);
  const setQty = (ttId, q) => setQuantities((prev) => ({ ...prev, [ttId]: q }));

  async function submit(e) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const { token } = await api(`/events/${event.id}/orders`, {
        method: 'POST',
        body: {
          ...buyer,
          paymentMethod,
          locale: lang,
          items: Object.entries(quantities)
            .filter(([, q]) => q > 0)
            .map(([ticketTypeId, quantity]) => ({ ticketTypeId: Number(ticketTypeId), quantity })),
        },
      });
      navigate(`/commande/${token}`);
    } catch (err) {
      setError(err);
      if (err.code === 'sold_out') {
        // Quelqu'un a pris les dernières places entre-temps : on affiche les disponibilités à jour.
        const fresh = await reload();
        if (fresh) {
          setQuantities((prev) =>
            Object.fromEntries(
              Object.entries(prev).map(([ttId, q]) => [ttId, Math.min(q, fresh.ticketTypes.find((x) => x.id === Number(ttId))?.available ?? 0)]),
            ),
          );
        }
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="container">
      <Link to="/" className="small">
        ← {t('nav.events')}
      </Link>
      <div className="event-layout" style={{ marginTop: 12 }}>
        <article className="stack">
          <div className="row small muted">
            <span className="collective-dot" style={{ background: event.collective.color }} />
            <Link to={`/c/${event.collective.slug}`}>{event.collective.name}</Link>
            {event.isOnline && <span className="badge badge-info">{t('list.online')}</span>}
          </div>
          <h1>{event.title}</h1>
          <EventTime iso={event.startsAt} timeZone={event.timezone} />
          {!event.isOnline && <p>📍 {event.venue}</p>}
          {event.description && <p className="muted">{event.description}</p>}
          <p className="small muted">
            {t('event.cancelPolicy', { h: event.cancelDeadlineHours })} {t('event.maxPerOrder', { n: event.maxPerOrder })}
          </p>
          {event.status === 'cancelled' && <div className="alert alert-error">{t('event.cancelled')}</div>}
          {event.status !== 'cancelled' && !event.salesOpen && <div className="alert alert-warn">{t('event.closed')}</div>}
        </article>

        {event.salesOpen && (
          <form className="card stack sticky" onSubmit={submit}>
            <h2>{t('event.tickets')}</h2>
            <div>
              {event.ticketTypes.map((tt) => {
                const q = quantities[tt.id] ?? 0;
                const max = Math.min(tt.available, event.maxPerOrder - (totalQty - q));
                return (
                  <div key={tt.id} className="ticket-row">
                    <div>
                      <div style={{ fontWeight: 600 }}>{tt.name}</div>
                      <div className="price">
                        {tt.earlyActive && <s>{formatMoney(tt.priceCents, lang)}</s>}
                        {formatMoney(effectivePrice(tt), lang)}
                      </div>
                      {tt.earlyActive && (
                        <div className="small" style={{ color: 'var(--accent)' }}>
                          {t('event.early', { date: formatShort(tt.earlyUntil, event.timezone, lang) })}
                          {tt.earlyRemaining != null && ` · ${t('event.earlyLeft', { n: tt.earlyRemaining })}`}
                        </div>
                      )}
                      {tt.available > 0 && tt.available <= 20 && (
                        <div className="small" style={{ color: 'var(--warn)' }}>
                          {t('event.left', { n: tt.available })}
                        </div>
                      )}
                    </div>
                    {tt.available > 0 ? (
                      <div className="stepper">
                        <button
                          type="button"
                          onClick={() => setQty(tt.id, q - 1)}
                          disabled={q === 0}
                          aria-label={t('event.decrease', { name: tt.name })}
                        >
                          −
                        </button>
                        <output aria-live="polite">{q}</output>
                        <button
                          type="button"
                          onClick={() => setQty(tt.id, q + 1)}
                          disabled={q >= max}
                          aria-label={t('event.increase', { name: tt.name })}
                        >
                          +
                        </button>
                      </div>
                    ) : (
                      <span className="badge badge-bad">{t('event.soldOut')}</span>
                    )}
                    {tt.available === 0 && (
                      <div style={{ gridColumn: '1 / -1' }}>
                        {waitlistFor === tt.id ? (
                          <WaitlistForm event={event} ticketType={tt} onClose={() => setWaitlistFor(null)} />
                        ) : (
                          <button type="button" className="btn btn-small" onClick={() => setWaitlistFor(tt.id)}>
                            🔔 {t('event.waitlist')}
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {totalQty > 0 && (
              <>
                <fieldset className="stack" style={{ border: 0, padding: 0, margin: 0 }}>
                  <legend className="label" style={{ marginBottom: 8 }}>
                    {t('event.yourInfo')}
                  </legend>
                  <label className="field">
                    <span>{t('event.name')}</span>
                    <input
                      required
                      autoComplete="name"
                      value={buyer.buyerName}
                      onChange={(e) => setBuyer({ ...buyer, buyerName: e.target.value })}
                    />
                  </label>
                  <label className="field">
                    <span>{t('event.email')}</span>
                    <input
                      required
                      type="email"
                      autoComplete="email"
                      value={buyer.buyerEmail}
                      onChange={(e) => setBuyer({ ...buyer, buyerEmail: e.target.value })}
                    />
                  </label>
                </fieldset>

                <fieldset className="stack" style={{ border: 0, padding: 0, margin: 0 }}>
                  <legend className="label" style={{ marginBottom: 8 }}>
                    {t('event.payment')}
                  </legend>
                  <label className="choice">
                    <input type="radio" name="pm" checked={paymentMethod === 'card'} onChange={() => setPaymentMethod('card')} />
                    <span>
                      <strong>{t('event.card')}</strong>
                      <br />
                      <span className="small muted">{t('event.cardHint')}</span>
                    </span>
                  </label>
                  <label className="choice">
                    <input
                      type="radio"
                      name="pm"
                      disabled={!event.transferAllowed}
                      checked={paymentMethod === 'transfer'}
                      onChange={() => setPaymentMethod('transfer')}
                    />
                    <span>
                      <strong>{t('event.transfer')}</strong>
                      <br />
                      <span className="small muted">
                        {event.transferAllowed ? t('event.transferHint') : t('event.transferClosed')}
                      </span>
                    </span>
                  </label>
                </fieldset>

                <div className="total-line">
                  <span>{t('event.total')}</span>
                  <span>{formatMoney(totalCents, lang)}</span>
                </div>
                <ErrorMessage error={error} />
                <button className="btn btn-primary btn-block btn-large" disabled={submitting}>
                  {t('event.submit')}
                </button>
              </>
            )}
          </form>
        )}
      </div>
    </div>
  );
}

function WaitlistForm({ event, ticketType, onClose }) {
  const { t, lang } = useLang();
  const [form, setForm] = useState({ name: '', email: '', quantity: 1 });
  const [done, setDone] = useState(null);
  const [error, setError] = useState(null);
  const [sending, setSending] = useState(false);

  if (done) return <div className="alert alert-success">{t('waitlist.done', { n: done.position })}</div>;

  async function submit() {
    setSending(true);
    setError(null);
    try {
      setDone(
        await api(`/events/${event.id}/waitlist`, {
          method: 'POST',
          body: { ...form, ticketTypeId: ticketType.id, locale: lang },
        }),
      );
    } catch (err) {
      setError(err);
    } finally {
      setSending(false);
    }
  }

  // Pas de <form> imbriqué : le formulaire d'achat englobe déjà cette zone.
  return (
    <div
      className="card card-tight stack"
      style={{ marginTop: 8, boxShadow: 'none' }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && e.target.tagName === 'INPUT') {
          e.preventDefault();
          submit();
        }
      }}
    >
      <h3>{t('waitlist.title', { name: ticketType.name })}</h3>
      <p className="small muted">{t('waitlist.explain')}</p>
      {ticketType.waitlistCount > 0 && <p className="small">{t('event.waitlistCount', { n: ticketType.waitlistCount })}</p>}
      <label className="field">
        <span>{t('event.name')}</span>
        <input autoComplete="name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
      </label>
      <label className="field">
        <span>E-mail</span>
        <input type="email" autoComplete="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
      </label>
      <label className="field">
        <span>{t('waitlist.quantity')}</span>
        <select value={form.quantity} onChange={(e) => setForm({ ...form, quantity: Number(e.target.value) })}>
          {Array.from({ length: event.maxPerOrder }, (_, i) => (
            <option key={i + 1}>{i + 1}</option>
          ))}
        </select>
      </label>
      <ErrorMessage error={error} />
      <div className="row">
        <button type="button" className="btn btn-primary" onClick={submit} disabled={sending || !form.name || !form.email}>
          {t('waitlist.submit')}
        </button>
        <button type="button" className="btn btn-ghost" onClick={onClose}>
          {t('common.cancel')}
        </button>
      </div>
    </div>
  );
}
