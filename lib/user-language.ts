/**
 * User language preference helpers.
 *
 * Priority (read):
 *   1. localStorage key 'frgx_user_language' — set explicitly during onboarding/settings
 *   2. navigator.language base tag (e.g. "nl" from "nl-NL")
 *   3. "en" hard default
 *
 * The returned value is always a lowercase BCP-47 base tag (e.g. "nl", "ar").
 */

const STORAGE_KEY = 'frgx_user_language';

function normalise(tag: string): string {
  return tag.trim().toLowerCase().split(/[-_]/)[0] || 'en';
}

export function getUserLanguage(): string {
  // Allow overriding via ?lang=nl URL param (persists to localStorage)
  if (typeof window !== 'undefined') {
    const param = new URLSearchParams(window.location.search).get('lang');
    if (param) {
      const normalised = normalise(param);
      setUserLanguage(normalised);
      return normalised;
    }
  }
  if (typeof localStorage !== 'undefined') {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) return normalise(stored);
  }
  if (typeof navigator !== 'undefined' && navigator.language) {
    return normalise(navigator.language);
  }
  return 'en';
}

export function setUserLanguage(lang: string): void {
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem(STORAGE_KEY, normalise(lang));
  }
}
