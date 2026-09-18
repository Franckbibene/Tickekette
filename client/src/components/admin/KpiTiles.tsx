import type { EventStats } from '../../types/api';
import { formatMoney } from '../../utils/format';
import { Meter } from '../common/Meter';

function totalsOf(stats: EventStats) {
  return stats.types.reduce(
    (acc, t) => ({
      quota: acc.quota + t.quota,
      sold: acc.sold + t.sold,
      held: acc.held + t.held,
      entered: acc.entered + t.entered,
      waiting: acc.waiting + t.waiting,
    }),
    { quota: 0, sold: 0, held: 0, entered: 0, waiting: 0 },
  );
}

export function KpiTiles({ stats }: { stats: EventStats }) {
  const totals = totalsOf(stats);
  return (
    <dl className="kpis">
      <div className="card kpi">
        <dt className="label">Places vendues</dt>
        <dd className="value">
          {totals.sold}
          <span className="small muted"> / {totals.quota}</span>
        </dd>
        <dd>
          <Meter sold={totals.sold} held={totals.held} quota={totals.quota} />
        </dd>
      </div>
      <div className="card kpi">
        <dt className="label">Réservées, non payées</dt>
        <dd className="value">{totals.held}</dd>
        <dd className="sub">
          {stats.pending.orders} commande(s) · {formatMoney(stats.pending.cents)}
        </dd>
      </div>
      <div className="card kpi">
        <dt className="label">Encaissé net</dt>
        <dd className="value">{formatMoney(stats.money.netCents)}</dd>
        <dd className="sub">
          brut {formatMoney(stats.money.grossCents)} · frais {formatMoney(stats.money.feesCents)}
        </dd>
      </div>
      <div className="card kpi">
        <dt className="label">Entrées</dt>
        <dd className="value">
          {totals.entered}
          <span className="small muted"> / {totals.sold}</span>
        </dd>
        <dd className="sub">{totals.waiting} en liste d’attente</dd>
      </div>
    </dl>
  );
}
