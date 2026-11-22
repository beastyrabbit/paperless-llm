import { createHash, randomUUID } from "node:crypto";

export const now = () => new Date().toISOString();
export const id = () => randomUUID();
export const sha256 = (value: string | Uint8Array) =>
  createHash("sha256").update(value).digest("hex");
export const json = (value: unknown) => JSON.stringify(value);
export const parseJson = <T>(value: string | null, fallback: T): T =>
  value === null ? fallback : (JSON.parse(value) as T);
export const equal = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
export const empty = (value: unknown) =>
  value === null || value === undefined || value === "" || (Array.isArray(value) && !value.length);

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly service: string,
  ) {
    super(`${service}: HTTP ${status}`);
  }
  get transient() {
    return this.status === 408 || this.status === 429 || this.status >= 500;
  }
}

export class NetworkError extends Error {
  constructor(service: string) {
    super(`${service}: request failed or timed out`);
  }
}

export async function fetchJson(
  request: typeof fetch,
  url: string | URL,
  init: RequestInit,
  service: string,
  timeoutMs = 60_000,
): Promise<unknown> {
  let response: Response;
  try {
    response = await request(url, {
      ...init,
      redirect: "error",
      signal: init.signal ?? AbortSignal.timeout(timeoutMs),
    });
  } catch {
    throw new NetworkError(service);
  }
  if (!response.ok) {
    await response.body?.cancel();
    // Provider bodies can contain document text or credentials. Never persist them in errors.
    throw new HttpError(response.status, service);
  }
  if (response.status === 204) return null;
  return response.json();
}

export function endpoint(base: string, path: string): string {
  return `${base.replace(/\/$/, "")}/${path.replace(/^\//, "")}`;
}
