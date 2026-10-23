import type { ServerResponse } from "node:http";

export const getVersion = () => ({
  version: process.env["APP_VERSION"] ?? "dev",
  revision: process.env["APP_REVISION"] ?? "unknown",
});

export const setVersionCacheHeaders = (
  method: string | undefined,
  path: string,
  res: ServerResponse,
): void => {
  if (method === "GET" && (path === "/api/version" || path === "/")) {
    res.setHeader("Cache-Control", "no-store");
  }
};
