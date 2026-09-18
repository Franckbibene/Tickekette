import { useState } from 'react';
import { devToolsApi } from '../../api/devTools';
import { ErrorMessage } from '../../components/common/Feedback';
import { QueryView } from '../../components/common/QueryView';
import { useApiQuery } from '../../hooks/useApiQuery';
import { useAsyncAction } from '../../hooks/useAsyncAction';
import { formatShort } from '../../utils/format';
import { userTimeZone } from '../../utils/timezones';

const REFRESH_MS = 4000;
const CLOCK_STEPS = [
  [11, '+11 min'],
  [121, '+2 h'],
  [49 * 60, '+49 h'],
] as const;

// Outil de démonstration (développement uniquement) : mails envoyés par l'application
// et horloge du serveur accélérable pour montrer les expirations sans attendre.
export default function MailboxPage() {
  const mails = useApiQuery('dev:mails', (signal) => devToolsApi.emails(signal), { intervalMs: REFRESH_MS });
  const clock = useApiQuery('dev:clock', (signal) => devToolsApi.clock(signal));
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const mail = useApiQuery(selectedId === null ? null : `dev:mail:${selectedId}`, (signal) => devToolsApi.email(selectedId ?? 0, signal));
  const changeClock = useAsyncAction(async (minutes: number | null) => {
    clock.setData(minutes === null ? await devToolsApi.resetClock() : await devToolsApi.advanceClock(minutes));
    mails.reload();
  });
  const tz = userTimeZone();

  return (
    <div className="container stack">
      <h1>Boîte mail de démonstration</h1>
      <p className="muted">
        Les mails envoyés par l’application (billets, virements, liste d’attente, remboursements) arrivent ici. En production, ils partent
        par un service d’envoi de mails et cette page n’existe pas.
      </p>

      <section className="card stack" aria-labelledby="clock-title">
        <h2 id="clock-title">Horloge du serveur</h2>
        <p className="small muted">
          Avancez le temps pour voir une réservation expirer, une offre de liste d’attente passer à la personne suivante, ou le tarif early
          se terminer.
          {clock.data && (
            <>
              {' '}
              Heure simulée : <strong>{formatShort(clock.data.now, tz)}</strong>
              {clock.data.offsetMinutes > 0 && ` (+${clock.data.offsetMinutes} min)`}.
            </>
          )}
        </p>
        <div className="row">
          {CLOCK_STEPS.map(([minutes, label]) => (
            <button
              key={minutes}
              type="button"
              className="btn btn-small"
              disabled={changeClock.pending}
              onClick={() => void changeClock.run(minutes)}
            >
              {label}
            </button>
          ))}
          <button
            type="button"
            className="btn btn-small btn-ghost"
            disabled={changeClock.pending}
            onClick={() => void changeClock.run(null)}
          >
            Revenir à l’heure réelle
          </button>
        </div>
        <ErrorMessage error={changeClock.error} />
      </section>

      <QueryView query={mails} empty="Aucun mail pour l’instant. Passez une commande !">
        {(list) => (
          <div className="mailbox">
            <ul className="card mail-list plain-list" aria-label="Mails envoyés">
              {list.map((m) => (
                <li key={m.id}>
                  <button type="button" aria-current={selectedId === m.id} onClick={() => setSelectedId(m.id)}>
                    <span className="small muted spread">
                      <span>{m.to}</span>
                      <span>{formatShort(m.createdAt, tz)}</span>
                    </span>
                    <span className="mail-subject">{m.subject}</span>
                  </button>
                </li>
              ))}
            </ul>
            {selectedId === null ? (
              <p className="muted">Sélectionnez un mail.</p>
            ) : (
              <QueryView query={mail}>
                {(m) => (
                  // HTML généré par le serveur (valeurs échappées), affiché dans un cadre isolé :
                  // aucun script ne peut s'y exécuter (sandbox sans allow-scripts).
                  <iframe
                    title={m.subject}
                    className="mail-frame"
                    sandbox="allow-popups allow-top-navigation-by-user-activation"
                    srcDoc={m.html.replace('<body', '<head><base target="_top"></head><body')}
                  />
                )}
              </QueryView>
            )}
          </div>
        )}
      </QueryView>
    </div>
  );
}
