import { createContext } from 'react';
import type { Lang, TranslationKey } from '../i18n/dictionaries';

export interface LangContextValue {
  lang: Lang;
  setLang: (lang: Lang) => void;
  t: (key: TranslationKey, vars?: Record<string, string | number>) => string;
}

export const LangContext = createContext<LangContextValue | null>(null);
