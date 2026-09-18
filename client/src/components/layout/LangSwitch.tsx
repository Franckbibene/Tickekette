import { useLang } from '../../hooks/useLang';
import { LANGS } from '../../i18n/dictionaries';

export function LangSwitch() {
  const { lang, setLang } = useLang();
  return (
    <div className="lang-switch" role="group" aria-label="Langue / Language">
      {LANGS.map((l) => (
        <button key={l} type="button" aria-pressed={lang === l} onClick={() => setLang(l)}>
          {l.toUpperCase()}
        </button>
      ))}
    </div>
  );
}
