import { Link, useParams } from 'react-router-dom';
import { api } from '../../api.js';
import { ErrorMessage, Loading, useResource } from '../../components/common.jsx';
import { useLang } from '../../i18n.jsx';
import { cityOf, dateParts, formatMoney, formatTime } from '../../time.js';

export default function EventsList() {
  const { slug } = useParams();
  const { t, lang } = useLang();
  const events = useResource(() => api(`/events${slug ? `?collective=${encodeURIComponent(slug)}` : ''}`), [slug]);
  const collectives = useResource(() => api('/collectives'), []);

  return (
    <div className="container">
      <section className="hero">
        <h1>{t('list.title')}</h1>
        <p className="muted">{t('list.subtitle')}</p>
        <nav className="chips" aria-label="Collectifs">
          <Link to="/" className={`chip ${slug ? '' : 'active'}`}>
            {t('list.all')}
          </Link>
          {collectives.data?.map((c) => (
            <Link key={c.id} to={`/c/${c.slug}`} className={`chip ${slug === c.slug ? 'active' : ''}`}>
              <span className="collective-dot" style={{ background: c.color }} />
              {c.name}
            </Link>
          ))}
        </nav>
      </section>

      <ErrorMessage error={events.error} />
      {!events.data && !events.error && <Loading />}
      {events.data?.length === 0 && <p className="muted">{t('list.empty')}</p>}

      <div className="event-grid">
        {events.data?.map((e) => {
          const d = dateParts(e.startsAt, e.timezone, lang);
          return (
            <Link key={e.id} to={`/evenements/${e.id}`} className="card event-card">
              <div className="date-block" aria-hidden="true">
                <span className="w">{d.weekday}</span>
                <span className="d">{d.day}</span>
                <span className="m">{d.month}</span>
              </div>
              <div style={{ minWidth: 0 }}>
                <div className="row small muted" style={{ marginBottom: 4 }}>
                  <span className="collective-dot" style={{ background: e.collective.color }} />
                  {e.collective.name}
                </div>
                <h3>{e.title}</h3>
                <p className="small muted" style={{ marginBottom: 8 }}>
                  {formatTime(e.startsAt, e.timezone, lang)} ({cityOf(e.timezone)}) ·{' '}
                  {e.isOnline ? t('list.online') : e.venue}
                </p>
                <div className="row">
                  {e.soldOut ? (
                    <span className="badge badge-bad">{t('list.soldOut')}</span>
                  ) : (
                    e.fromPriceCents != null && (
                      <span className="badge badge-accent">{t('list.from', { price: formatMoney(e.fromPriceCents, lang) })}</span>
                    )
                  )}
                  {e.isOnline && <span className="badge badge-info">{t('list.online')}</span>}
                </div>
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
