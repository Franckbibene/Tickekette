import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { LANGS, translate, type Lang, type TranslationKey } from '../i18n/dictionaries';
import { STORAGE_KEYS, storage } from '../utils/storage';
import { LangContext } from './langContext';

function initialLang(): Lang {
  const saved = storage.get<string | null>(STORAGE_KEYS.lang, null);
  if (LANGS.includes(saved as Lang)) return saved as Lang;
  return navigator.language.toLowerCase().startsWith('fr') ? 'fr' : 'en';
}

export function LangProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(initialLang);

  useEffect(() => {
    document.documentElement.lang = lang;
    storage.set(STORAGE_KEYS.lang, lang);
  }, [lang]);

  const t = useCallback((key: TranslationKey, vars?: Record<string, string | number>) => translate(lang, key, vars), [lang]);
  const value = useMemo(() => ({ lang, setLang: setLangState, t }), [lang, t]);
  return <LangContext.Provider value={value}>{children}</LangContext.Provider>;
}
