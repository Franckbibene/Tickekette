import { useState } from 'react';
import { api } from '../../api.js';
import { ErrorMessage, Loading, useResource } from '../../components/common.jsx';
import { formatShort, userTimeZone } from '../../time.js';

// Outil de démonstration : les mails envoyés par l'application et une horloge accélérable
// pour montrer l'expiration des réservations sans attendre.
export default function Mailbox() {
  const { data: mails, error, reload } = useResource(() => api('/dev/emails'), [], { intervalMs: 4000 });
  const clock = useResource(() => api('/dev/clock'), []);
  const [selected, setSelected] = useState(null);
  const [mail, setMail] = useState(null);

  async function open(id) {
    setSelected(id);
    setMail(await api(`/dev/emails/${id}`));
  }

  async function advance(minutes) {
    clock.setData(await api('/dev/clock/advance', { method: 'POST', body: { minutes } }));
    reload();
  }

  async function reset() {
    clock.setData(await api('/dev/clock/reset', { method: 'POST' }));
  }

  return (
    <div className="container stack">
      <h1>Boîte mail de démonstration</h1>
      <p className="muted">
        Les mails envoyés par l’application (billets, virements, liste d’attente, remboursements) arrivent ici. En
        production, ils partent par un service d’envoi de mails.
      </p>

      <section className="card stack">
        <h2>Horloge du serveur</h2>
        <p className="small muted">
          Avancez le temps pour voir une réservation expirer, une offre de liste d’attente passer à la personne suivante,
          ou le tarif early se terminer.
          {clock.data && (
            <>
              {' '}
              Heure simulée : <strong>{formatShort(clock.data.now, userTimeZone())}</strong>
              {clock.data.offsetMinutes > 0 && ` (+${clock.data.offsetMinutes} min)`}.
            </>
          )}
        </p>
        <div className="row">
          <button className="btn btn-small" onClick={() => advance(11)}>
            +11 min
          </button>
          <button className="btn btn-small" onClick={() => advance(121)}>
            +2 h
          </button>
          <button className="btn btn-small" onClick={() => advance(49 * 60)}>
            +49 h
          </button>
          <button className="btn btn-small btn-ghost" onClick={reset}>
            Revenir à l’heure réelle
          </button>
        </div>
      </section>

      <ErrorMessage error={error} />
      {!mails && !error && <Loading />}
      {mails?.length === 0 && <p className="muted">Aucun mail pour l’instant. Passez une commande !</p>}
      {mails?.length > 0 && (
        <div className="mailbox">
          <div className="card mail-list">
            {mails.map((m) => (
              <button key={m.id} aria-current={selected === m.id} onClick={() => open(m.id)}>
                <div className="small muted spread">
                  <span>{m.to}</span>
                  <span>{formatShort(m.createdAt, userTimeZone())}</span>
                </div>
                <div style={{ fontWeight: 600 }}>{m.subject}</div>
              </button>
            ))}
          </div>
          {mail ? (
            <iframe title={mail.subject} className="mail-frame" sandbox="allow-popups allow-top-navigation-by-user-activation" srcDoc={mail.html.replace('<body', '<head><base target="_top"></head><body')}
            />
          ) : (
            <p className="muted">Sélectionnez un mail.</p>
          )}
        </div>
      )}
    </div>
  );
}
