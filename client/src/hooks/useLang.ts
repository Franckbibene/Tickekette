import { useContext } from 'react';
import { LangContext } from '../contexts/langContext';

export function useLang() {
  const ctx = useContext(LangContext);
  if (!ctx) throw new Error('useLang doit être utilisé dans <LangProvider>.');
  return ctx;
}
