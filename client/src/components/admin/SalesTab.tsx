import type { EventStats } from '../../types/api';
import { formatMoney } from '../../utils/format';
import { Meter } from '../common/Meter';

export function SalesTab({ stats }: { stats: EventStats }) {
  return (
    <div className="stack">
      <div className="legend" aria-hidden="true">
        <span>
          <i className="legend-sold" />
          Vendues
        </span>
        <span>
          <i className="legend-held" />
          Réservées non payées
        </span>
      </div>
      <div className="table-wrap">
        <table>
          <caption className="visually-hidden">Ventes par type de place</caption>
          <thead>
            <tr>
              <th scope="col">Type</th>
              <th scope="col">Remplissage</th>
              <th scope="col" className="num">
                Vendues
              </th>
              <th scope="col" className="num">
                Réservées
              </th>
              <th scope="col" className="num">
                Restantes
              </th>
              <th scope="col" className="num">
                Remboursées
              </th>
              <th scope="col" className="num">
                Encaissé brut
              </th>
            </tr>
          </thead>
          <tbody>
            {stats.types.map((t) => (
              <tr key={t.id}>
                <th scope="row">
                  {t.name}
                  {t.waiting > 0 && <div className="small muted">{t.waiting} en attente</div>}
                </th>
                <td className="meter-cell">
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
        Remboursé au total : {formatMoney(stats.money.refundedCents)}. L’encaissé net déduit les frais du prestataire de paiement (non
        restitués en cas de remboursement).
      </p>
    </div>
  );
}
