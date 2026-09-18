import { Link, useParams } from 'react-router-dom';
import { eventsApi } from '../../api/events';
import { QueryView } from '../../components/common/QueryView';
import { EventCard } from '../../components/events/EventCard';
import { useApiQuery } from '../../hooks/useApiQuery';
import { useLang } from '../../hooks/useLang';

export default function EventsListPage() {
  const { slug } = useParams();
  const { t } = useLang();
  const events = useApiQuery(`events:${slug ?? ''}`, (signal) => eventsApi.list(slug, signal));
  const collectives = useApiQuery('collectives', (signal) => eventsApi.collectives(signal));

  return (
    <div className="container">
      <section className="hero">
        <h1>{t('list.title')}</h1>
        <p className="muted">{t('list.subtitle')}</p>
        <nav className="chips" aria-label={t('nav.collectives')}>
          <Link to="/" className={`chip ${slug ? '' : 'active'}`} aria-current={slug ? undefined : 'page'}>
            {t('list.all')}
          </Link>
          {collectives.data?.map((c) => (
            <Link
              key={c.slug}
              to={`/c/${c.slug}`}
              className={`chip ${slug === c.slug ? 'active' : ''}`}
              aria-current={slug === c.slug ? 'page' : undefined}
            >
              <span className="collective-dot" style={{ background: c.color }} />
              {c.name}
            </Link>
          ))}
        </nav>
      </section>
      <QueryView query={events} empty={t('list.empty')}>
        {(list) => (
          <ul className="event-grid plain-list">
            {list.map((event) => (
              <EventCard key={event.id} event={event} />
            ))}
          </ul>
        )}
      </QueryView>
    </div>
  );
}
