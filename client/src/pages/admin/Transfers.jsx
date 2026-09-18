import { useState } from 'react';
import { api } from '../../api.js';
import { ErrorMessage, Loading, StatusBadge, useResource } from '../../components/common.jsx';
import { formatMoney, formatShort } from '../../time.js';

const RESULTS = {
  paid: ['success', 'Virement enregistré : billets envoyés.'],
  paid_late: ['success', 'Virement en retard, mais il restait des places : billets envoyés.'],
  refunded_late: ['warn', 'Virement arrivé trop tard et places revendues : à rembourser par virement (mail envoyé).'],
  refunded_duplicate: ['warn', 'Commande déjà payée : ce virement est à rembourser.'],
  refunded_amount_mismatch: ['warn', 'Montant incorrect : virement à rembourser.'],
  already_recorded: ['info', 'Ce virement était déjà enregistré.'],
};

export default function Transfers() {
  const { data: orders, error, reload } = useResource(() => api('/admin/transfers'), [], { intervalMs: 15_000 });
  const [message, setMessage] = useState(null);
  const [busy, setBusy] = useState(null);

  async function confirm(order) {
    if (!window.confirm(`Confirmer la réception de ${formatMoney(order.totalCents)} (référence ${order.reference}) ?`)) return;
    setBusy(order.id);
    setMessage(null);
    try {
      const { status } = await api(`/admin/orders/${order.id}/confirm-transfer`, { method: 'POST' });
      const [tone, text] = RESULTS[status] ?? ['info', status];
      setMessage({ tone, text: `${order.reference} — ${text}` });
      reload();
    } catch (err) {
      setMessage({ tone: 'error', text: err.message });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="stack">
      <h1>Virements à rapprocher</h1>
      <p className="muted">
        Comparez avec votre relevé bancaire (montant et référence), puis confirmez la réception : les billets partent
        aussitôt. Les réservations par virement non payées sont libérées au bout de 48 h ; un virement reçu après ce délai
        reste confirmable s’il reste des places.
      </p>
      {message && <div className={`alert alert-${message.tone}`}>{message.text}</div>}
      <ErrorMessage error={error} />
      {!orders && !error && <Loading />}
      {orders?.length === 0 && <p className="muted">Aucun virement en attente.</p>}
      {orders?.length > 0 && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Référence</th>
                <th>Acheteur</th>
                <th>Événement</th>
                <th className="num">Montant</th>
                <th>Statut</th>
                <th />
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
                  <td className="small">{o.eventTitle}</td>
                  <td className="num">{formatMoney(o.totalCents)}</td>
                  <td>
                    <StatusBadge status={o.status} />
                    <div className="small muted">
                      {o.status === 'pending' ? 'expire' : 'expirée'} {formatShort(o.expiresAt, o.timezone)}
                    </div>
                  </td>
                  <td>
                    <button className="btn btn-small btn-primary" disabled={busy === o.id} onClick={() => confirm(o)}>
                      Virement reçu
                    </button>
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
