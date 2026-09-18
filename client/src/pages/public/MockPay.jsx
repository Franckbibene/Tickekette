import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../../api.js';
import { ErrorMessage, Loading, useResource } from '../../components/common.jsx';
import { formatMoney } from '../../time.js';

// Page du prestataire de paiement SIMULÉ. En production, l'acheteur serait redirigé
// vers la page de paiement de Stripe, SumUp, etc.
export default function MockPay() {
  const { sessionId } = useParams();
  const navigate = useNavigate();
  const { data: session, error } = useResource(() => api(`/mock-provider/sessions/${sessionId}`), [sessionId]);
  const [duplicate, setDuplicate] = useState(true);
  const [paying, setPaying] = useState(false);
  const [payError, setPayError] = useState(null);

  async function pay() {
    setPaying(true);
    setPayError(null);
    try {
      const { returnUrl } = await api(`/mock-provider/sessions/${sessionId}/pay`, {
        method: 'POST',
        body: { duplicateNotification: duplicate },
      });
      navigate(returnUrl);
    } catch (err) {
      setPayError(err);
      setPaying(false);
    }
  }

  return (
    <div className="mock-pay">
      <div className="card stack">
        <div className="spread">
          <strong style={{ fontSize: '1.2rem' }}>💳 MockPay</strong>
          <span className="badge badge-warn">Simulation</span>
        </div>
        {error && <ErrorMessage error={error} />}
        {!session && !error && <Loading />}
        {session && (
          <>
            <div>
              <div className="small" style={{ color: '#64748b' }}>
                {session.label}
              </div>
              <div style={{ fontSize: '2rem', fontWeight: 800 }}>{formatMoney(session.amountCents)}</div>
            </div>
            {session.status === 'paid' ? (
              <div className="alert alert-success">Cette session est déjà payée.</div>
            ) : (
              <>
                <label className="field">
                  <span>Numéro de carte (factice)</span>
                  <input value="4242 4242 4242 4242" readOnly style={{ background: '#f8fafc', color: '#0f172a' }} />
                </label>
                <label className="row small" style={{ alignItems: 'flex-start', flexWrap: 'nowrap' }}>
                  <input type="checkbox" checked={duplicate} onChange={(e) => setDuplicate(e.target.checked)} />
                  <span>
                    Envoyer la notification de paiement <strong>deux fois</strong>, comme le prestataire actuel du
                    client. Un seul lot de billets doit être émis.
                  </span>
                </label>
                <ErrorMessage error={payError} />
                <button className="btn btn-primary btn-block btn-large" onClick={pay} disabled={paying}>
                  {paying ? 'Paiement…' : `Payer ${formatMoney(session.amountCents)}`}
                </button>
              </>
            )}
            <button className="btn btn-ghost btn-small" onClick={() => navigate(session.returnUrl)}>
              ← Retour à la commande
            </button>
          </>
        )}
      </div>
    </div>
  );
}
