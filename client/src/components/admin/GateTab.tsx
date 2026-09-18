import type { EventStats } from '../../types/api';
import { formatTime } from '../../utils/format';

export function GateTab({ stats, timeZone }: { stats: EventStats; timeZone: string }) {
  return (
    <div className="stack">
      <dl className="kpis">
        {stats.types.map((t) => (
          <div key={t.id} className="card kpi">
            <dt className="label">{t.name}</dt>
            <dd className="value">
              {t.entered} <span className="small muted">/ {t.sold} entrés</span>
            </dd>
          </div>
        ))}
      </dl>
      <h3>Alertes : billets présentés plusieurs fois</h3>
      {stats.alerts.length === 0 ? (
        <p className="muted">Aucune alerte.</p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th scope="col">Billet</th>
                <th scope="col">Première entrée</th>
                <th scope="col">Nouvelle tentative</th>
                <th scope="col">Type</th>
              </tr>
            </thead>
            <tbody>
              {stats.alerts.map((a) => (
                <tr key={a.id}>
                  <td>
                    {a.holderName}
                    <div className="mono small muted">{a.code}</div>
                  </td>
                  <td className="small">
                    {formatTime(a.firstEnteredAt, timeZone)} · {a.firstGate || '—'}
                  </td>
                  <td className="small">
                    {formatTime(a.scannedAt, timeZone)} · {a.gate || a.deviceId}
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
