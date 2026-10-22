export const getVersion = () => ({
  version: process.env["APP_VERSION"] ?? "dev",
  revision: process.env["APP_REVISION"] ?? "unknown",
});
