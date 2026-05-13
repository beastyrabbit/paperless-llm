import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./i18n/request.ts");

const nextConfig: NextConfig = {
  output: "standalone",

  // Hide dev indicators for clean screenshots
  devIndicators: false,

  // API requests are proxied by app/api/[...path]/route.ts so server-only auth
  // tokens can be attached without exposing them to the browser.
};

export default withNextIntl(nextConfig);
