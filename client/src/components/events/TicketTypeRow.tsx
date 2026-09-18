import { useState } from 'react';
import { useLang } from '../../hooks/useLang';
import type { EventDetail, PublicTicketType } from '../../types/api';
import { formatMoney, formatShort } from '../../utils/format';
import { effectivePrice } from '../../utils/pricing';
import { QuantityStepper } from './QuantityStepper';
import { WaitlistForm } from './WaitlistForm';

const LOW_STOCK_THRESHOLD = 20;

interface Props {
  event: EventDetail;
  ticketType: PublicTicketType;
  quantity: number;
  max: number;
  onChange: (quantity: number) => void;
}

export function TicketTypeRow({ event, ticketType: tt, quantity, max, onChange }: Props) {
  const { t, lang } = useLang();
  const [waitlistOpen, setWaitlistOpen] = useState(false);
  const soldOut = tt.available === 0;

  return (
    <li className="ticket-row">
      <div>
        <div className="ticket-name">{tt.name}</div>
        <div className="price">
          {tt.earlyActive && <s>{formatMoney(tt.priceCents, lang)}</s>}
          {formatMoney(effectivePrice(tt), lang)}
        </div>
        {tt.earlyActive && tt.earlyUntil && (
          <div className="small accent-text">
            {t('event.early', { date: formatShort(tt.earlyUntil, event.timezone, lang) })}
            {tt.earlyRemaining !== null && ` · ${t('event.earlyLeft', { n: tt.earlyRemaining })}`}
          </div>
        )}
        {!soldOut && tt.available <= LOW_STOCK_THRESHOLD && <div className="small warn-text">{t('event.left', { n: tt.available })}</div>}
      </div>
      {soldOut ? (
        <span className="badge badge-bad">{t('event.soldOut')}</span>
      ) : (
        <QuantityStepper
          value={quantity}
          max={max}
          label={t('event.quantity', { name: tt.name })}
          decreaseLabel={t('event.decrease', { name: tt.name })}
          increaseLabel={t('event.increase', { name: tt.name })}
          onChange={onChange}
        />
      )}
      {soldOut && (
        <div className="ticket-row-full">
          {waitlistOpen ? (
            <WaitlistForm event={event} ticketType={tt} onClose={() => setWaitlistOpen(false)} />
          ) : (
            <button type="button" className="btn btn-small" onClick={() => setWaitlistOpen(true)}>
              <span aria-hidden="true">🔔 </span>
              {t('event.waitlist')}
            </button>
          )}
        </div>
      )}
    </li>
  );
}
