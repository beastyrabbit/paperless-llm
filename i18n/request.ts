/**
 * next-intl request configuration.
 *
 * This module provides the locale and messages for server components.
 */

import { getRequestConfig } from "next-intl/server";
import { defaultLocale, type Locale } from "./config";

export default getRequestConfig(async () => {
  // For now, we use the default locale
  // In the future, this can be extended to read from cookies/headers
  const locale: Locale = defaultLocale;

  return {
    locale,
    messages: (await import(`../messages/${locale}.json`)).default,
  };
});
