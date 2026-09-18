import { useState } from 'react';
import { adminApi } from '../../api/admin';
import { QueryView } from '../../components/common/QueryView';
import { OrderStatusBadge } from '../../components/common/StatusBadge';
import { useApiQuery } from '../../hooks/useApiQuery';
import { useAsyncAction } from '../../hooks/useAsyncAction';
import type { TransferOrder, TransferOutcome } from '../../types/api';
import { formatMoney, formatShort } from '../../utils/format';

const REFRESH_MS = 15_000;

const OUTCOMES: Record<TransferOutcome, ['success' | 'warn' | 'info', string]> = {
  paid: ['success', 'Virement enregistré : billets envoyés.'],
  paid_late: ['success', 'Virement en retard, mais il restait des places : billets envoyés.'],
  refunded_late: ['warn', 'Virement arrivé trop tard et places revendues : à rembourser par virement (mail envoyé).'],
  refunded_duplicate: ['warn', 'Commande déjà payée : ce virement est à rembourser.'],
  refunded_amount_mismatch: ['warn', 'Montant incorrect : virement à rembourser.'],
  already_recorded: ['info', 'Ce virement était déjà enregistré.'],
};

export default function TransfersPage() {
  const transfers = useApiQuery('admin:transfers', (signal) => adminApi.transfers(signal), { intervalMs: REFRESH_MS });
  const [message, setMessage] = useState<{ tone: 'success' | 'warn' | 'info'; text: string } | null>(null);
  const confirm = useAsyncAction(async (order: TransferOrder) => {
    const { status } = await adminApi.confirmTransfer(order.id);
    const [tone, text] = OUTCOMES[status];
    setMessage({ tone, text: `${order.reference} — ${text}` });
    transfers.reload();
  });

  function onConfirm(order: TransferOrder) {
    if (window.confirm(`Confirmer la réception de ${formatMoney(order.totalCents)} (référence ${order.reference}) ?`)) {
      setMessage(null);
      void confirm.run(order);
    }
  }

  return (
    <div className="stack">
      <h1>Virements à rapprocher</h1>
      <p className="muted">
        Comparez avec votre relevé bancaire (montant et référence), puis confirmez la réception : les billets partent aussitôt. Les
        réservations par virement non payées sont libérées au bout de 48 h ; un virement reçu après ce délai reste confirmable s’il reste
        des places.
      </p>
      {message && (
        <div className={`alert alert-${message.tone}`} role="status">
          {message.text}
        </div>
      )}
      {confirm.error && (
        <div className="alert alert-error" role="alert">
          {confirm.error.message}
        </div>
      )}
      <QueryView query={transfers} empty="Aucun virement en attente.">
        {(list) => (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th scope="col">Référence</th>
                  <th scope="col">Acheteur</th>
                  <th scope="col">Événement</th>
                  <th scope="col" className="num">
                    Montant
                  </th>
                  <th scope="col">Statut</th>
                  <th scope="col">
                    <span className="visually-hidden">Action</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {list.map((o) => (
                  <tr key={o.id}>
                    <td className="mono">{o.reference}</td>
                    <td>
                      {o.buyerName}
                      <div className="small muted">{o.buyerEmail}</div>
                    </td>
                    <td className="small">{o.eventTitle}</td>
                    <td className="num">{formatMoney(o.totalCents)}</td>
                    <td>
                      <OrderStatusBadge status={o.status} />
                      <div className="small muted">
                        {o.status === 'pending' ? 'expire' : 'expirée'} {formatShort(o.expiresAt, o.timezone)}
                      </div>
                    </td>
                    <td>
                      <button type="button" className="btn btn-small btn-primary" disabled={confirm.pending} onClick={() => onConfirm(o)}>
                        Virement reçu
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </QueryView>
    </div>
  );
}
