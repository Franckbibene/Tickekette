import { useRef, useState, type SubmitEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { eventsApi } from '../../api/events';
import { ApiError } from '../../api/http';
import { useAsyncAction } from '../../hooks/useAsyncAction';
import { useLang } from '../../hooks/useLang';
import type { EventDetail, OrderRequest, PaymentMethod } from '../../types/api';
import { formatMoney } from '../../utils/format';
import { FIELD_LIMITS, hasErrors, validateEmail, validateName, type FieldErrors } from '../../utils/validation';
import { ErrorMessage } from '../common/Feedback';
import { TextField } from '../forms/Field';

interface Props {
  event: EventDetail;
  items: { ticketTypeId: number; quantity: number }[];
  totalCents: number;
  onSoldOut: () => void;
}

// Coordonnées + moyen de paiement + validation. Le total affiché est indicatif :
// le serveur recalcule toujours le prix à partir du tarif officiel.
export function CheckoutForm({ event, items, totalCents, onSoldOut }: Props) {
  const { t, lang } = useLang();
  const navigate = useNavigate();
  const [buyer, setBuyer] = useState({ name: '', email: '' });
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('card');
  const [errors, setErrors] = useState<FieldErrors<'name' | 'email'>>({});
  // Une même commande (mêmes données) garde la même clé d'idempotence : un nouvel essai
  // après une coupure réseau ou un double clic ne crée pas de seconde réservation.
  const attempt = useRef<{ signature: string; key: string } | null>(null);

  const order = useAsyncAction(async (request: OrderRequest) => {
    const signature = JSON.stringify(request);
    if (attempt.current?.signature !== signature) attempt.current = { signature, key: crypto.randomUUID() };
    try {
      const { token } = await eventsApi.createOrder(event.id, request, attempt.current.key);
      void navigate(`/commande/${encodeURIComponent(token)}`);
    } catch (err) {
      // Quelqu'un a pris les dernières places entre-temps : on recharge les disponibilités.
      if (err instanceof ApiError && err.code === 'sold_out') onSoldOut();
      throw err;
    }
  });

  async function submit(e: SubmitEvent<HTMLFormElement>) {
    e.preventDefault();
    const next = { name: validateName(buyer.name), email: validateEmail(buyer.email) };
    setErrors(next);
    if (hasErrors(next)) return;
    await order.run({ buyerName: buyer.name.trim(), buyerEmail: buyer.email.trim(), paymentMethod, locale: lang, items });
  }

  return (
    <form className="stack" onSubmit={(e) => void submit(e)} noValidate>
      <fieldset className="stack plain-fieldset">
        <legend className="label">{t('event.yourInfo')}</legend>
        <TextField
          label={t('event.name')}
          required
          autoComplete="name"
          maxLength={FIELD_LIMITS.name}
          value={buyer.name}
          error={errors.name}
          onChange={(e) => setBuyer({ ...buyer, name: e.target.value })}
        />
        <TextField
          label={t('event.email')}
          type="email"
          required
          autoComplete="email"
          maxLength={FIELD_LIMITS.email}
          value={buyer.email}
          error={errors.email}
          onChange={(e) => setBuyer({ ...buyer, email: e.target.value })}
        />
      </fieldset>

      <fieldset className="stack plain-fieldset">
        <legend className="label">{t('event.payment')}</legend>
        <label className="choice">
          <input type="radio" name="payment" checked={paymentMethod === 'card'} onChange={() => setPaymentMethod('card')} />
          <span>
            <strong>{t('event.card')}</strong>
            <br />
            <span className="small muted">{t('event.cardHint')}</span>
          </span>
        </label>
        <label className="choice">
          <input
            type="radio"
            name="payment"
            disabled={!event.transferAllowed}
            checked={paymentMethod === 'transfer'}
            onChange={() => setPaymentMethod('transfer')}
          />
          <span>
            <strong>{t('event.transfer')}</strong>
            <br />
            <span className="small muted">{event.transferAllowed ? t('event.transferHint') : t('event.transferClosed')}</span>
          </span>
        </label>
      </fieldset>

      <div className="total-line">
        <span>{t('event.total')}</span>
        <span>{formatMoney(totalCents, lang)}</span>
      </div>
      <ErrorMessage error={order.error} />
      <button type="submit" className="btn btn-primary btn-block btn-large" disabled={order.pending}>
        {order.pending ? t('event.submitting') : t('event.submit')}
      </button>
    </form>
  );
}
