import { useLang } from '../../hooks/useLang';
import { formatDateTime } from '../../utils/format';
import { cityOf, sameClock, userTimeZone } from '../../utils/timezones';

// Heure de l'événement à l'heure du lieu, et à l'heure du visiteur si elle est différente (5.10).
export function EventTime({ iso, timeZone }: { iso: string; timeZone: string }) {
  const { t, lang } = useLang();
  const mine = userTimeZone();
  return (
    <div className="event-time">
      <div>
        <strong>
          <time dateTime={iso}>{formatDateTime(iso, timeZone, lang)}</time>
        </strong>{' '}
        <span className="muted small">({t('time.local', { city: cityOf(timeZone) })})</span>
      </div>
      {!sameClock(iso, timeZone, mine) && (
        <div className="tz-hint">
          <span aria-hidden="true">🌍 </span>
          {t('time.yours', { time: formatDateTime(iso, mine, lang), city: cityOf(mine) })}
        </div>
      )}
    </div>
  );
}
