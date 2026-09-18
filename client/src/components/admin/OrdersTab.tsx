import { useState } from 'react';
import { adminApi } from '../../api/admin';
import { useApiQuery } from '../../hooks/useApiQuery';
import type { OrderStatus, RefundReason } from '../../types/api';
import { formatMoney, formatShort } from '../../utils/format';
import { QueryView } from '../common/QueryView';
import { OrderStatusBadge } from '../common/StatusBadge';
import { SelectField } from '../forms/Field';

const REFRESH_MS = 10_000;

const REASONS: Record<RefundReason, string> = {
  buyer_cancelled: 'annulée par l’acheteur',
  event_cancelled: 'événement annulé',
  late_payment_sold_out: 'paiement arrivé trop tard',
  duplicate_payment: 'paiement en double',
  amount_mismatch: 'montant incorrect',
};

const FILTERS: [OrderStatus | '', string][] = [
  ['', 'Toutes les commandes'],
  ['paid', 'Payées'],
  ['pending', 'En attente de paiement'],
  ['refunded', 'Remboursées'],
  ['expired', 'Expirées'],
  ['cancelled', 'Abandonnées'],
];

const isFilter = (value: string): value is OrderStatus | '' => FILTERS.some(([v]) => v === value);

export function OrdersTab({ eventId, timeZone }: { eventId: number; timeZone: string }) {
  const [status, setStatus] = useState<OrderStatus | ''>('');
  const orders = useApiQuery(`orders:${eventId}:${status}`, (signal) => adminApi.orders(eventId, status, signal), {
    intervalMs: REFRESH_MS,
  });

  return (
    <div className="stack">
      <div className="filter-field">
        <SelectField label="Filtrer" value={status} onChange={(e) => isFilter(e.target.value) && setStatus(e.target.value)}>
          {FILTERS.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </SelectField>
      </div>
      <QueryView query={orders} empty="Aucune commande.">
        {(list) => (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th scope="col">Référence</th>
                  <th scope="col">Acheteur</th>
                  <th scope="col">Places</th>
                  <th scope="col">Statut</th>
                  <th scope="col" className="num">
                    Montant
                  </th>
                  <th scope="col">Date</th>
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
                    <td className="small">{o.summary}</td>
                    <td>
                      <OrderStatusBadge status={o.status} />
                      <div className="small muted">
                        {o.paymentMethod === 'transfer' ? 'Virement' : 'Carte'}
                        {o.waitlistEntryId !== null && ' · liste d’attente'}
                        {o.refundReason && ` · ${REASONS[o.refundReason]}`}
                        {o.status === 'pending' && ` · expire ${formatShort(o.expiresAt, timeZone)}`}
                      </div>
                    </td>
                    <td className="num">{formatMoney(o.totalCents)}</td>
                    <td className="small nowrap">{formatShort(o.createdAt, timeZone)}</td>
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
