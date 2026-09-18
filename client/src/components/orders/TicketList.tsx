import { QRCodeSVG } from 'qrcode.react';
import { useLang } from '../../hooks/useLang';
import type { Order } from '../../types/api';
import { formatDateTime } from '../../utils/format';
import { ExternalLink } from '../common/ExternalLink';

const QR_SIZE = 200;

export function TicketList({ order }: { order: Order }) {
  const { t, lang } = useLang();
  return (
    <>
      <div className="alert alert-success" role="status">
        <strong>{t('order.paid')}</strong>
        <br />
        <span className="small">{t('order.paidMail', { email: order.buyerEmail })}</span>
      </div>
      {order.event.isOnline && (
        <ExternalLink href={order.event.onlineUrl} className="btn btn-primary btn-large">
          {t('order.onlineAccess')} ↗
        </ExternalLink>
      )}
      <ul className="tickets plain-list">
        {order.tickets.map((ticket) => (
          <li key={ticket.code} className={`card ticket ${ticket.enteredAt ? 'used' : ''}`}>
            <span className="badge badge-accent">{ticket.ticketTypeName}</span>
            <div className="qr">
              <QRCodeSVG value={ticket.qr} size={QR_SIZE} level="M" marginSize={0} title={t('order.ticketLabel', { code: ticket.code })} />
            </div>
            <strong>{ticket.holderName}</strong>
            <span className="mono small muted">{ticket.code}</span>
            {ticket.enteredAt && (
              <span className="badge">{t('order.entered', { date: formatDateTime(ticket.enteredAt, order.event.timezone, lang) })}</span>
            )}
          </li>
        ))}
      </ul>
      <p className="small muted">{t('order.ticketHint')}</p>
      <div className="no-print">
        <button type="button" className="btn" onClick={() => window.print()}>
          {t('order.print')}
        </button>
      </div>
    </>
  );
}
