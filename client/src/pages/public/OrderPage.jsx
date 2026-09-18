import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { QRCodeSVG } from 'qrcode.react';
import { api } from '../../api.js';
import { ErrorMessage, EventTime, Loading, useResource } from '../../components/common.jsx';
import { useLang } from '../../i18n.jsx';
import { formatDateTime, formatMoney } from '../../time.js';

function useCountdown(expiresAt, serverNow) {
  // On corrige l'horloge du téléphone avec celle du serveur.
  const [skew, setSkew] = useState(0);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (serverNow) setSkew(Date.parse(serverNow) - Date.now());
  }, [serverNow]);
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  if (!expiresAt) return null;
  return Math.max(0, Date.parse(expiresAt) - (now + skew));
}

function formatDuration(ms) {
  const total = Math.ceil(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n) => String(n).padStart(2, '0');
  return h > 0 ? `${h} h ${pad(m)}` : `${pad(m)}:${pad(s)}`;
}

export default function OrderPage() {
  const { token } = useParams();
  const { t, lang } = useLang();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState(null);
  // Tant que la commande attend un paiement, on la recharge : le statut change dès que
  // le prestataire confirme le paiement ou que le délai est dépassé.
  const { data: order, error, reload, setData } = useResource(() => api(`/orders/${token}`), [token], { intervalMs: 4000 });
  const remaining = useCountdown(order?.status === 'pending' ? order.expiresAt : null, order?.serverNow);

  useEffect(() => {
    if (remaining === 0) reload();
  }, [remaining, reload]);

  if (error && !order) {
    return (
      <div className="container narrow">
        <ErrorMessage error={error} />
      </div>
    );
  }
  if (!order) {
    return (
      <div className="container">
        <Loading />
      </div>
    );
  }

  const { event } = order;

  async function pay() {
    setBusy(true);
    setActionError(null);
    try {
      const { redirectUrl } = await api(`/orders/${token}/checkout`, { method: 'POST' });
      navigate(redirectUrl);
    } catch (err) {
      setActionError(err);
      reload();
    } finally {
      setBusy(false);
    }
  }

  async function cancel(message) {
    if (!window.confirm(message)) return;
    setBusy(true);
    setActionError(null);
    try {
      setData(await api(`/orders/${token}/cancel`, { method: 'POST' }));
    } catch (err) {
      setActionError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="container narrow stack">
      <div className="no-print">
        <Link to={`/evenements/${event.id}`} className="small">
          ← {event.title}
        </Link>
      </div>
      <div>
        <p className="small muted mono" style={{ marginBottom: 4 }}>
          {t('order.title', { ref: order.reference })}
        </p>
        <h1>{event.title}</h1>
        <EventTime iso={event.startsAt} timeZone={event.timezone} />
        {!event.isOnline && <p style={{ marginTop: 8 }}>📍 {event.venue}</p>}
      </div>

      {order.status === 'pending' && order.paymentMethod === 'card' && (
        <section className="card stack">
          {order.isWaitlistOffer && <div className="alert alert-success">🎉 {t('order.offer')}</div>}
          <h2>{t('order.reserved')}</h2>
          <div className="countdown" aria-live="off">
            {remaining != null && formatDuration(remaining)}
          </div>
          <p className="muted">{t('order.expiresIn', { time: remaining != null ? formatDuration(remaining) : '' })}</p>
          <OrderSummary order={order} />
          <ErrorMessage error={actionError} />
          <button className="btn btn-primary btn-block btn-large" onClick={pay} disabled={busy || remaining === 0}>
            {t('order.pay', { amount: formatMoney(order.totalCents, lang) })}
          </button>
          <button className="btn btn-ghost btn-small" onClick={() => cancel(t('order.releaseConfirm'))} disabled={busy}>
            {t('order.release')}
          </button>
        </section>
      )}

      {order.status === 'pending' && order.paymentMethod === 'transfer' && (
        <section className="card stack">
          <h2>{t('order.transferTitle')}</h2>
          <p className="muted">{t('order.transferExplain')}</p>
          <dl className="kv">
            <dt>{t('order.amount')}</dt>
            <dd>{formatMoney(order.totalCents, lang)}</dd>
            <dt>{t('order.iban')}</dt>
            <dd className="mono">{order.bank.iban}</dd>
            <dt>{t('order.reference')}</dt>
            <dd className="mono">{order.bank.reference}</dd>
            <dt>{t('order.deadline')}</dt>
            <dd>{formatDateTime(order.expiresAt, event.timezone, lang)}</dd>
          </dl>
          <OrderSummary order={order} />
          <ErrorMessage error={actionError} />
          <button className="btn btn-ghost btn-small" onClick={() => cancel(t('order.releaseConfirm'))} disabled={busy}>
            {t('order.release')}
          </button>
        </section>
      )}

      {order.status === 'paid' && (
        <>
          <div className="alert alert-success">
            <strong>✅ {t('order.paid')}</strong>
            <br />
            <span className="small">{t('order.paidMail', { email: order.buyerEmail })}</span>
          </div>
          {event.isOnline && event.onlineUrl && (
            <a className="btn btn-primary btn-large" href={event.onlineUrl} target="_blank" rel="noreferrer">
              {t('order.onlineAccess')} ↗
            </a>
          )}
          <div className="tickets">
            {order.tickets.map((ticket) => (
              <div key={ticket.code} className={`card ticket ${ticket.enteredAt ? 'used' : ''}`}>
                <span className="badge badge-accent">{ticket.ticketTypeName}</span>
                <div className="qr">
                  <QRCodeSVG value={ticket.qr} size={200} level="M" marginSize={0} title={`Billet ${ticket.code}`} />
                </div>
                <strong>{ticket.holderName}</strong>
                <span className="mono small muted">{ticket.code}</span>
                {ticket.enteredAt && (
                  <span className="badge">{t('order.entered', { date: formatDateTime(ticket.enteredAt, event.timezone, lang) })}</span>
                )}
              </div>
            ))}
          </div>
          <p className="small muted">{t('order.ticketHint')}</p>
          <div className="no-print">
            <button className="btn" onClick={() => window.print()}>
              🖨 {t('order.print')}
            </button>
          </div>
          <section className="card stack no-print">
            <h2>{t('order.cancelTitle')}</h2>
            <OrderSummary order={order} />
            {order.canCancel ? (
              <>
                <p className="muted">{t('order.cancelUntil', { date: formatDateTime(order.cancelDeadline, event.timezone, lang) })}</p>
                <ErrorMessage error={actionError} />
                <button className="btn btn-danger" onClick={() => cancel(t('order.cancelConfirm'))} disabled={busy}>
                  {t('order.cancelBtn')}
                </button>
              </>
            ) : (
              <p className="muted">{t('order.cancelClosed', { date: formatDateTime(order.cancelDeadline, event.timezone, lang) })}</p>
            )}
          </section>
        </>
      )}

      {['expired', 'cancelled', 'refunded'].includes(order.status) && (
        <section className="card stack">
          <div className={`alert ${order.status === 'refunded' ? 'alert-info' : 'alert-warn'}`}>
            {t(`order.${order.status}`)}
            {order.refundReason && (
              <>
                <br />
                <span className="small">{t(`reason.${order.refundReason}`)}</span>
              </>
            )}
          </div>
          <OrderSummary order={order} />
          <Link to={`/evenements/${event.id}`} className="btn">
            {t('order.backToEvent')}
          </Link>
        </section>
      )}
    </div>
  );
}

function OrderSummary({ order }) {
  const { t, lang } = useLang();
  return (
    <div>
      <h3 className="small muted" style={{ textTransform: 'uppercase', letterSpacing: '0.04em' }}>
        {t('order.summary')}
      </h3>
      {order.items.map((i, idx) => (
        <div key={idx} className="spread small" style={{ padding: '4px 0' }}>
          <span>
            {i.quantity} × {i.ticketTypeName} {i.isEarly && <span className="badge badge-accent">{t('order.early')}</span>}
          </span>
          <span>{formatMoney(i.quantity * i.unitPriceCents, lang)}</span>
        </div>
      ))}
      <div className="total-line" style={{ fontSize: '1rem', marginTop: 6 }}>
        <span>{t('event.total')}</span>
        <span>{formatMoney(order.totalCents, lang)}</span>
      </div>
    </div>
  );
}
