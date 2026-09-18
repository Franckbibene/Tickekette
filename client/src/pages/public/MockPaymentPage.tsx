import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { mockPaymentApi } from '../../api/orders';
import { QueryView } from '../../components/common/QueryView';
import { ErrorMessage } from '../../components/common/Feedback';
import { useApiQuery } from '../../hooks/useApiQuery';
import { useAsyncAction } from '../../hooks/useAsyncAction';
import { formatMoney } from '../../utils/format';
import { safeInternalPath } from '../../utils/url';

// Page du prestataire de paiement SIMULÉ (démo). En production, l'acheteur serait redirigé
// vers Stripe, SumUp… et cette page n'existe pas (le serveur la désactive).
export default function MockPaymentPage() {
  const sessionId = useParams().sessionId ?? '';
  const navigate = useNavigate();
  const session = useApiQuery(`session:${sessionId}`, (signal) => mockPaymentApi.session(sessionId, signal));
  const [duplicate, setDuplicate] = useState(true);
  const goBack = (url: string) => {
    void navigate(safeInternalPath(url));
  };
  const pay = useAsyncAction(async () => goBack((await mockPaymentApi.pay(sessionId, duplicate)).returnUrl));

  return (
    <main className="mock-pay">
      <div className="card stack">
        <div className="spread">
          <strong className="mock-pay-brand">MockPay</strong>
          <span className="badge badge-warn">Simulation</span>
        </div>
        <QueryView query={session}>
          {(s) => (
            <>
              <div>
                <div className="small muted">{s.label}</div>
                <div className="mock-pay-amount">{formatMoney(s.amountCents)}</div>
              </div>
              {s.status === 'paid' ? (
                <div className="alert alert-success">Cette session est déjà payée.</div>
              ) : (
                <>
                  <div className="field">
                    <label htmlFor="fake-card">Numéro de carte (factice)</label>
                    <input id="fake-card" value="4242 4242 4242 4242" readOnly />
                  </div>
                  <label className="row small checkbox-row">
                    <input type="checkbox" checked={duplicate} onChange={(e) => setDuplicate(e.target.checked)} />
                    <span>
                      Envoyer la notification de paiement <strong>deux fois</strong>, comme le prestataire actuel du client. Un seul lot de
                      billets doit être émis.
                    </span>
                  </label>
                  <ErrorMessage error={pay.error} />
                  <button
                    type="button"
                    className="btn btn-primary btn-block btn-large"
                    onClick={() => void pay.run()}
                    disabled={pay.pending}
                  >
                    {pay.pending ? 'Paiement…' : `Payer ${formatMoney(s.amountCents)}`}
                  </button>
                </>
              )}
              <button type="button" className="btn btn-ghost btn-small" onClick={() => goBack(s.returnUrl)}>
                ← Retour à la commande
              </button>
            </>
          )}
        </QueryView>
      </div>
    </main>
  );
}
