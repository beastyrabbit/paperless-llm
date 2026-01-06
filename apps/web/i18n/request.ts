/**
 * next-intl request configuration.
 *
 * This module provides the locale and messages for server components.
 * Reads the user's preferred locale from the NEXT_LOCALE cookie.
 */

import { getRequestConfig } from "next-intl/server";
import { cookies } from "next/headers";
import { defaultLocale, locales, type Locale } from "./config";

export const LOCALE_COOKIE_NAME = "NEXT_LOCALE";

export default getRequestConfig(async () => {
  // Read locale from cookie, fallback to default
  const cookieStore = await cookies();
  const cookieLocale = cookieStore.get(LOCALE_COOKIE_NAME)?.value;

  // Validate the locale is one we support
  const locale: Locale = locales.includes(cookieLocale as Locale)
    ? (cookieLocale as Locale)
    : defaultLocale;

  return {
    locale,
    messages: (await import(`../messages/${locale}.json`)).default,
  };
});
