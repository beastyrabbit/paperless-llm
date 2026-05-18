export const ALLOWED_PAPERLESS_HOSTS = (process.env["PAPERLESS_ALLOWED_HOSTS"] ?? "")
  .split(",")
  .map((host) => host.trim().toLowerCase())
  .filter(Boolean);

export const normalizePaperlessUrl = (value: string): string => {
  const parsed = new URL(value);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("Paperless URL must use http or https");
  }
  if (parsed.username || parsed.password) {
    throw new Error("Paperless URL must not include credentials");
  }
  if (
    ALLOWED_PAPERLESS_HOSTS.length > 0 &&
    !ALLOWED_PAPERLESS_HOSTS.includes(parsed.hostname.toLowerCase())
  ) {
    throw new Error(`Paperless host '${parsed.hostname}' is not in PAPERLESS_ALLOWED_HOSTS`);
  }
  const pathname = parsed.pathname.replace(/\/+$/, "");
  return `${parsed.origin}${pathname}`;
};

export const normalizeConfiguredPaperlessUrl = (configuredUrl?: string | null): string => {
  if (!configuredUrl) return "";
  return normalizePaperlessUrl(configuredUrl);
};
