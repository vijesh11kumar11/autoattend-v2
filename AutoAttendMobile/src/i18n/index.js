/**
 * AutoAttend AI v2.0 — i18n bootstrap (mobile)
 *
 * Minimal react-i18next setup. English only for now; no language detection and
 * no in-app language switcher. This is infrastructure so future translations
 * can be added without re-plumbing.
 *
 * To add a new language: copy locales/en.json to locales/ta.json (Tamil),
 * translate the strings, then register it in the `resources` map below
 * (e.g. ta: { translation: ta }) and import the file at the top.
 */

import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

import en from './locales/en.json';

i18n.use(initReactI18next).init({
  resources: {
    en: { translation: en },
  },
  lng: 'en',
  fallbackLng: 'en',
  interpolation: {
    escapeValue: false, // React already escapes by default
  },
});

export default i18n;
