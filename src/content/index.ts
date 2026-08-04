import { createSignal } from 'solid-js';
import { en } from './en';
import { fr } from './fr';

/**
 * Translation without a library.
 *
 * Two dictionaries, one signal, and a lookup that falls back to English. The
 * whole i18n machinery a static page needs, and nothing that would have to be
 * kept up to date.
 */

export type Locale = 'en' | 'fr';

const DICTIONARIES: Record<Locale, Record<string, string>> = { en, fr };

function initialLocale(): Locale {
  if (typeof window === 'undefined') return 'en';
  const fromUrl = new URLSearchParams(window.location.search).get('lang');
  if (fromUrl === 'fr' || fromUrl === 'en') return fromUrl;
  return navigator.language.startsWith('fr') ? 'fr' : 'en';
}

const [locale, setLocaleSignal] = createSignal<Locale>(initialLocale());

export { locale };

export function setLocale(next: Locale): void {
  setLocaleSignal(next);
  if (typeof window !== 'undefined') {
    const url = new URL(window.location.href);
    url.searchParams.set('lang', next);
    window.history.replaceState({}, '', url);
    document.documentElement.lang = next;
  }
}

/** Looks up a key, falling back to English, then to the key itself. */
export function t(key: string): string {
  const dictionary = DICTIONARIES[locale()];
  const value = dictionary[key] ?? en[key];
  if (value === undefined && import.meta.env.DEV) {
    console.warn(`[content] missing key: ${key}`);
  }
  return value ?? key;
}

/** True when a key exists in either dictionary, for optional explanations. */
export function hasKey(key: string): boolean {
  return key in DICTIONARIES[locale()] || key in en;
}
