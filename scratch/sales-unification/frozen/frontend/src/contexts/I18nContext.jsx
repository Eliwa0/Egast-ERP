import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { translations } from '../i18n/translations';

const I18nContext = createContext(null);

const STORAGE_KEY = 'app-lang';

function getInitialLang() {
  const stored = window.localStorage.getItem(STORAGE_KEY);
  return stored === 'ar' ? 'ar' : 'en';
}

export function I18nProvider({ children }) {
  const [lang, setLangState] = useState(getInitialLang);

  const setLang = (next) => {
    setLangState(next);
    window.localStorage.setItem(STORAGE_KEY, next);
  };

  useEffect(() => {
    document.documentElement.dir  = lang === 'ar' ? 'rtl' : 'ltr';
    document.documentElement.lang = lang;
  }, [lang]);

  // t('wizard.step1')  or  t('common.save')
  const t = useCallback((path, ...args) => {
    if (!path || typeof path !== 'string') return '';
    const keys = path.split('.');
    let node = translations[lang];
    for (const k of keys) {
      if (node == null) return path;
      node = node[k];
    }
    if (typeof node === 'function') return node(...args);
    if (typeof node === 'string') return node;
    return path;
  }, [lang]);

  return (
    <I18nContext.Provider value={{ lang, setLang, t }}>
      {children}
    </I18nContext.Provider>
  );
}

export function useI18n() {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useI18n must be used inside I18nProvider');
  return ctx;
}
