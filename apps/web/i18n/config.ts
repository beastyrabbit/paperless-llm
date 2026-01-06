/**
 * Internationalization configuration for next-intl.
 *
 * This defines the supported locales for the UI.
 * Note: This is separate from prompt languages which are managed by the backend.
 */

export const locales = ["en", "de"] as const;
export type Locale = (typeof locales)[number];

export const defaultLocale: Locale = "en";

export const localeNames: Record<Locale, string> = {
  en: "English",
  de: "Deutsch",
};
