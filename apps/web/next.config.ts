import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./i18n/request.ts");

const nextConfig: NextConfig = {
  output: "standalone",
  env: {
    APP_VERSION: process.env.APP_VERSION ?? "dev",
    APP_REVISION: process.env.APP_REVISION ?? "unknown",
  },

  // Hide dev indicators for clean screenshots
  devIndicators: false,

  // API requests are proxied by app/api/[...path]/route.ts so server-only auth
  // tokens can be attached without exposing them to the browser.
};

export default withNextIntl(nextConfig);
