import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import sv from './locales/sv.json';
import en from './locales/en.json';

/**
 * i18n, wired in Phase 0 rather than retrofitted.
 *
 * The source workbook is Swedish and so is the shop floor, so `sv` is the
 * default and the fallback — an untranslated key shows Swedish, never an
 * English string leaking into a Swedish UI.
 *
 * The cost of doing this now is one dependency and a JSON file. The cost of
 * doing it after Phase 4 is every component.
 */

export const SUPPORTED_LANGUAGES = ['sv', 'en'] as const;
export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number];

export const DEFAULT_LANGUAGE: SupportedLanguage = 'sv';

const STORAGE_KEY = 'taskhub.language';

/**
 * Swedish unless the user has explicitly chosen otherwise.
 *
 * Deliberately *not* browser-locale detection. This is a Swedish shop floor
 * replacing a Swedish workbook; someone whose Windows is set to English would
 * otherwise get an English UI for a tool where every column name comes from the
 * Swedish original. English is one click away in the language switcher, and
 * that choice is remembered.
 */
function detectLanguage(): SupportedLanguage {
  if (typeof window === 'undefined') return DEFAULT_LANGUAGE;

  const stored = window.localStorage.getItem(STORAGE_KEY);
  if (stored !== null && (SUPPORTED_LANGUAGES as readonly string[]).includes(stored)) {
    return stored as SupportedLanguage;
  }

  return DEFAULT_LANGUAGE;
}

export function setLanguage(language: SupportedLanguage): void {
  void i18n.changeLanguage(language);
  if (typeof window !== 'undefined') {
    window.localStorage.setItem(STORAGE_KEY, language);
    window.document.documentElement.lang = language;
  }
}

void i18n.use(initReactI18next).init({
  resources: {
    sv: { translation: sv },
    en: { translation: en },
  },
  lng: detectLanguage(),
  fallbackLng: DEFAULT_LANGUAGE,
  interpolation: {
    // React already escapes.
    escapeValue: false,
  },
});

export default i18n;
