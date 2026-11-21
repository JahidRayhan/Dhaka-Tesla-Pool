import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { formatTaka } from './format';
import { storage } from './storage';
import { localizeDigits, pickInitialLanguage, plural, translate } from './strings';

const KEY = 'dtp_lang';
const LanguageContext = createContext(null);

function deviceLocale() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().locale;
  } catch {
    return 'en';
  }
}

export function LanguageProvider({ children }) {
  const [lang, setLangState] = useState(() => pickInitialLanguage(deviceLocale()));

  // A choice the person made earlier beats the phone's language.
  useEffect(() => {
    storage.get(KEY).then((saved) => {
      if (saved === 'en' || saved === 'bn') setLangState(saved);
    }).catch(() => {});
  }, []);

  const setLang = useCallback((next) => {
    setLangState(next);
    storage.set(KEY, next).catch(() => {});
  }, []);

  const value = useMemo(
    () => ({
      lang,
      setLang,
      t: (key, vars) => translate(lang, key, vars),
      tn: (key, n) => plural(lang, key, n),
      money: (paisa) => localizeDigits(formatTaka(paisa), lang),
      num: (n) => localizeDigits(n, lang),
    }),
    [lang, setLang],
  );
  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export function useI18n() {
  const ctx = useContext(LanguageContext);
  if (!ctx) throw new Error('useI18n must be used within LanguageProvider');
  return ctx;
}
