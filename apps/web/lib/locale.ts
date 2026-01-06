/**
 * Client-side locale utilities for managing UI language preference.
 */

import { locales, type Locale } from "@/i18n/config";

export const LOCALE_COOKIE_NAME = "NEXT_LOCALE";

/**
 * Get the current locale from the cookie.
 * Returns undefined if not set or invalid.
 */
export function getLocaleFromCookie(): Locale | undefined {
  if (typeof document === "undefined") return undefined;

  const cookies = document.cookie.split(";");
  for (const cookie of cookies) {
    const [name, value] = cookie.trim().split("=");
    if (name === LOCALE_COOKIE_NAME) {
      const locale = value as Locale;
      if (locales.includes(locale)) {
        return locale;
      }
    }
  }
  return undefined;
}

/**
 * Set the locale cookie and reload the page to apply the change.
 * The cookie is set for 1 year.
 */
export function setLocale(locale: Locale): void {
  if (!locales.includes(locale)) {
    console.error(`Invalid locale: ${locale}`);
    return;
  }

  // Set cookie with 1 year expiry
  const maxAge = 60 * 60 * 24 * 365; // 1 year in seconds
  document.cookie = `${LOCALE_COOKIE_NAME}=${locale}; path=/; max-age=${maxAge}; SameSite=Lax`;

  // Reload to apply the new locale
  window.location.reload();
}
