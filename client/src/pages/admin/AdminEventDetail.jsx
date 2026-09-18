import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, download } from '../../api.js';
import { ErrorMessage, EventTime, Loading, StatusBadge, useResource } from '../../components/common.jsx';
import { formatMoney, formatShort, formatTime } from '../../time.js';
import { Meter } from './AdminEvents.jsx';

const REASONS = {
  buyer_cancelled: 'annulée par l’acheteur',
  event_cancelled: 'événement annulé',
  late_payment_sold_out: 'paiement arrivé trop tard',
  duplicate_payment: 'paiement en double',
  amount_mismatch: 'montant incorrect',
};

export default function AdminEventDetail() {
  const { id } = useParams();
  const { data: event, error, setData: setEvent } = useResource(() => api(`/admin/events/${id}`), [id]);
  // (5.8) Chiffres rafraîchis toutes les 5 secondes.
  const { data: stats } = useResource(() => api(`/admin/events/${id}/stats`), [id], { intervalMs: 5000 });
  const [tab, setTab] = useState('sales');
  const [actionError, setActionError] = useState(null);

  if (error) return <ErrorMessage error={error} />;
  if (!event) return <Loading />;

  async function action(path, confirmMessage) {
    if (confirmMessage && !window.confirm(confirmMessage)) return;
    setActionError(null);
    try {
      setEvent(await api(`/admin/events/${id}/${path}`, { method: 'POST' }));
    } catch (err) {
      setActionError(err);
    }
  }

  const totals = stats?.types.reduce(
    (acc, t) => ({
      quota: acc.quota + t.quota,
      sold: acc.sold + t.sold,
      held: acc.held + t.held,
      entered: acc.entered + t.entered,
      waiting: acc.waiting + t.waiting,
    }),
    { quota: 0, sold: 0, held: 0, entered: 0, waiting: 0 },
  );

  return (
    <div className="stack">
      <Link to="/admin" className="small">
        ← Événements
      </Link>
      <div className="spread" style={{ alignItems: 'flex-start' }}>
        <div>
          <div className="row" style={{ marginBottom: 6 }}>
            <StatusBadge status={event.status} kind="event" />
            {event.isOnline && <span className="badge badge-info">En ligne</span>}
          </div>
          <h1>{event.title}</h1>
          <EventTime iso={event.startsAt} timeZone={event.timezone} />
          <p className="muted" style={{ marginTop: 6 }}>
            {event.isOnline ? event.onlineUrl : event.venue}
          </p>
        </div>
        <div className="row">
          {event.status === 'draft' && (
            <button className="btn btn-primary" onClick={() => action('publish')}>
              Publier
            </button>
          )}
          {event.status !== 'cancelled' && (
            <Link className="btn" to={`/admin/evenements/${id}/modifier`}>
              Modifier
            </Link>
          )}
          {event.status !== 'draft' && (
            <Link className="btn" to={`/evenements/${id}`} target="_blank">
              Page publique ↗
            </Link>
          )}
        </div>
      </div>
      <ErrorMessage error={actionError} />

      {stats && (
        <div className="kpis">
          <div className="card kpi">
            <div className="label">Places vendues</div>
            <div className="value">
              {totals.sold}
              <span className="small muted"> / {totals.quota}</span>
            </div>
            <Meter sold={totals.sold} held={totals.held} quota={totals.quota} />
          </div>
          <div className="card kpi">
            <div className="label">Réservées, non payées</div>
            <div className="value">{totals.held}</div>
            <div className="sub">
              {stats.pending.orders} commande(s) · {formatMoney(stats.pending.cents)}
            </div>
          </div>
          <div className="card kpi">
            <div className="label">Encaissé net</div>
            <div className="value">{formatMoney(stats.money.netCents)}</div>
            <div className="sub">
              brut {formatMoney(stats.money.grossCents)} · frais {formatMoney(stats.money.feesCents)}
            </div>
          </div>
          <div className="card kpi">
            <div className="label">Entrées</div>
            <div className="value">
              {totals.entered}
              <span className="small muted"> / {totals.sold}</span>
            </div>
            <div className="sub">{totals.waiting} en liste d’attente</div>
          </div>
        </div>
      )}
      {stats && (
        <p className="small muted">
          <span className="live-dot" aria-hidden="true" />
          Mis à jour à {formatTime(stats.updatedAt, event.timezone)} — actualisation automatique toutes les 5 s
        </p>
      )}

      <div className="tabs" role="tablist">
        {[
          ['sales', 'Ventes par type'],
          ['orders', 'Commandes'],
          ['waitlist', 'Liste d’attente'],
          ['gate', `Contrôle${stats?.alerts.length ? ` (${stats.alerts.length} ⚠️)` : ''}`],
        ].map(([key, label]) => (
          <button key={key} role="tab" aria-selected={tab === key} onClick={() => setTab(key)}>
            {label}
          </button>
        ))}
      </div>

      {tab === 'sales' && stats && <SalesTab stats={stats} />}
      {tab === 'orders' && <OrdersTab eventId={id} timeZone={event.timezone} />}
      {tab === 'waitlist' && <WaitlistTab eventId={id} timeZone={event.timezone} />}
      {tab === 'gate' && stats && <GateTab stats={stats} event={event} />}

      <section className="card stack">
        <h2>Exports et actions</h2>
        <div className="row">
          <button className="btn" onClick={() => download(`/admin/events/${id}/participants.csv`, 'participants.csv').catch(setActionError)}>
            ⬇ Liste des participants (Excel / CSV)
          </button>
          {event.status === 'published' && (
            <Link className="btn" to={`/controle/${id}`}>
              📷 Ouvrir le contrôle à l’entrée
            </Link>
          )}
        </div>
        {event.status !== 'cancelled' && (
          <div>
            <button
              className="btn btn-danger"
              onClick={() =>
                action(
                  'cancel',
                  'Annuler l’événement ? Toutes les commandes payées seront remboursées et les participants prévenus par mail. Cette action est définitive.',
                )
              }
            >
              Annuler l’événement et rembourser tout le monde
            </button>
          </div>
        )}
      </section>
    </div>
  );
}

function SalesTab({ stats }) {
  return (
    <div className="stack">
      <div className="legend" aria-hidden="true">
        <span>
          <i style={{ background: 'var(--accent)' }} />
          Vendues
        </span>
        <span>
          <i style={{ background: 'repeating-linear-gradient(45deg, var(--accent) 0 3px, transparent 3px 6px)', opacity: 0.6 }} />
          Réservées non payées
        </span>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Type</th>
              <th>Remplissage</th>
              <th className="num">Vendues</th>
              <th className="num">Réservées</th>
              <th className="num">Restantes</th>
              <th className="num">Remboursées</th>
              <th className="num">Encaissé brut</th>
            </tr>
          </thead>
          <tbody>
            {stats.types.map((t) => (
              <tr key={t.id}>
                <td style={{ fontWeight: 600 }}>
                  {t.name}
                  {t.waiting > 0 && <div className="small muted">{t.waiting} en attente</div>}
                </td>
                <td style={{ minWidth: 120 }}>
                  <Meter sold={t.sold} held={t.held} quota={t.quota} />
                </td>
                <td className="num">
                  {t.sold} <span className="muted small">/ {t.quota}</span>
                </td>
                <td className="num">{t.held}</td>
                <td className="num">{t.remaining === 0 ? <span className="badge badge-bad">Complet</span> : t.remaining}</td>
                <td className="num">{t.refunded}</td>
                <td className="num">{formatMoney(t.grossCents)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="small muted">
        Remboursé au total : {formatMoney(stats.money.refundedCents)}. L’encaissé net déduit les frais du prestataire de
        paiement (non restitués en cas de remboursement).
      </p>
    </div>
  );
}

function OrdersTab({ eventId, timeZone }) {
  const [status, setStatus] = useState('');
  const { data: orders, error } = useResource(() => api(`/admin/events/${eventId}/orders?status=${status}`), [eventId, status], {
    intervalMs: 10_000,
  });
  return (
    <div className="stack">
      <label className="field" style={{ maxWidth: 260 }}>
        <span>Filtrer</span>
        <select value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">Toutes les commandes</option>
          <option value="paid">Payées</option>
          <option value="pending">En attente de paiement</option>
          <option value="refunded">Remboursées</option>
          <option value="expired">Expirées</option>
          <option value="cancelled">Abandonnées</option>
        </select>
      </label>
      <ErrorMessage error={error} />
      {!orders && !error && <Loading />}
      {orders?.length === 0 && <p className="muted">Aucune commande.</p>}
      {orders?.length > 0 && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Référence</th>
                <th>Acheteur</th>
                <th>Places</th>
                <th>Statut</th>
                <th className="num">Montant</th>
                <th>Date</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((o) => (
                <tr key={o.id}>
                  <td className="mono">{o.reference}</td>
                  <td>
                    {o.buyerName}
                    <div className="small muted">{o.buyerEmail}</div>
                  </td>
                  <td className="small">{o.summary}</td>
                  <td>
                    <StatusBadge status={o.status} />
                    <div className="small muted">
                      {o.paymentMethod === 'transfer' ? 'Virement' : 'Carte'}
                      {o.waitlistEntryId && ' · liste d’attente'}
                      {o.refundReason && ` · ${REASONS[o.refundReason] ?? o.refundReason}`}
                      {o.status === 'pending' && ` · expire ${formatShort(o.expiresAt, timeZone)}`}
                    </div>
                  </td>
                  <td className="num">{formatMoney(o.totalCents)}</td>
                  <td className="small" style={{ whiteSpace: 'nowrap' }}>
                    {formatShort(o.createdAt, timeZone)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function WaitlistTab({ eventId, timeZone }) {
  const { data: entries, error } = useResource(() => api(`/admin/events/${eventId}/waitlist`), [eventId], { intervalMs: 10_000 });
  return (
    <div className="stack">
      <p className="small muted">
        Quand une place se libère, elle est automatiquement proposée à la première personne en attente, qui a 2 h pour
        payer. Sans paiement, la place passe à la suivante.
      </p>
      <ErrorMessage error={error} />
      {entries?.length === 0 && <p className="muted">Personne en liste d’attente.</p>}
      {entries?.length > 0 && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>#</th>
                <th>Personne</th>
                <th>Type</th>
                <th className="num">Places</th>
                <th>Statut</th>
                <th>Inscription</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((w, i) => (
                <tr key={w.id}>
                  <td>{i + 1}</td>
                  <td>
                    {w.name}
                    <div className="small muted">{w.email}</div>
                  </td>
                  <td>{w.ticketTypeName}</td>
                  <td className="num">{w.quantity}</td>
                  <td>
                    <StatusBadge status={w.status} kind="waitlist" />
                    {w.status === 'offered' && w.offerExpiresAt && (
                      <div className="small muted">jusqu’à {formatShort(w.offerExpiresAt, timeZone)}</div>
                    )}
                  </td>
                  <td className="small">{formatShort(w.createdAt, timeZone)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function GateTab({ stats, event }) {
  return (
    <div className="stack">
      <div className="kpis">
        {stats.types.map((t) => (
          <div key={t.id} className="card kpi">
            <div className="label">{t.name}</div>
            <div className="value">
              {t.entered} <span className="small muted">/ {t.sold} entrés</span>
            </div>
          </div>
        ))}
      </div>
      <h3>Alertes : billets présentés plusieurs fois</h3>
      {stats.alerts.length === 0 ? (
        <p className="muted">Aucune alerte.</p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Billet</th>
                <th>Première entrée</th>
                <th>Nouvelle tentative</th>
                <th>Type</th>
              </tr>
            </thead>
            <tbody>
              {stats.alerts.map((a, i) => (
                <tr key={i}>
                  <td>
                    {a.holderName}
                    <div className="mono small muted">{a.code}</div>
                  </td>
                  <td className="small">
                    {formatTime(a.firstEnteredAt, event.timezone)} · {a.firstGate || '—'}
                  </td>
                  <td className="small">
                    {formatTime(a.scannedAt, event.timezone)} · {a.gate || a.deviceId}
                  </td>
                  <td>
                    {a.offline ? (
                      <span className="badge badge-warn">Détecté après synchro hors ligne</span>
                    ) : (
                      <span className="badge badge-bad">Refusé à l’entrée</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
