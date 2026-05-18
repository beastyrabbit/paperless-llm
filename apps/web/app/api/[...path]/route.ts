export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ path: string[] }>;
};

const truthyEnvValues = new Set(["1", "true", "yes", "on"]);

const isTruthyEnvValue = (value: string | undefined): boolean =>
  truthyEnvValues.has(value?.trim().toLowerCase() ?? "");

const getBackendUrl = (): string => process.env.BACKEND_URL || "http://localhost:8765";

const getApiAuthToken = (): string =>
  process.env.PAPERLESS_LLM_API_TOKEN ?? process.env.LOCAL_LLM_API_KEY ?? "";

export const isProdReadOnlyMode = (): boolean =>
  isTruthyEnvValue(process.env.PAPERLESS_LLM_PROD_READ_ONLY) ||
  isTruthyEnvValue(process.env.PAPERLESS_LLM_READ_ONLY);

const READ_ONLY_SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const CSRF_SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const READ_ONLY_SAFE_POST_PATHS = [
  /^\/api\/settings\/test-connection\/(paperless|ollama|mistral)$/,
];
const READ_ONLY_BLOCKED_SAFE_METHOD_PATHS = [
  /^\/api\/processing\/\d+\/stream$/,
  /^\/api\/cases\/document\/\d+\/stream$/,
  /^\/api\/settings\/check-import$/,
];

export const isReadOnlyProxyRequestAllowed = (
  method: string | undefined,
  path: string,
): boolean => {
  const normalizedMethod = method?.toUpperCase() ?? "GET";
  if (
    normalizedMethod !== "OPTIONS" &&
    READ_ONLY_BLOCKED_SAFE_METHOD_PATHS.some((pattern) => pattern.test(path))
  ) {
    return false;
  }
  if (READ_ONLY_SAFE_METHODS.has(normalizedMethod)) return true;
  if (normalizedMethod !== "POST") return false;
  return READ_ONLY_SAFE_POST_PATHS.some((pattern) => pattern.test(path));
};

const readOnlyResponse = (): Response =>
  Response.json(
    {
      status: 403,
      error: "Read Only Mode",
      message:
        "PAPERLESS_LLM_PROD_READ_ONLY is enabled; mutating API requests are blocked to protect production documents.",
    },
    { status: 403 },
  );

const csrfResponse = (): Response =>
  Response.json(
    {
      status: 403,
      error: "CSRF Protection",
      message: "Mutating API proxy requests must originate from the same origin.",
    },
    { status: 403 },
  );

const firstForwardedHeaderValue = (value: string | null): string | undefined =>
  value
    ?.split(",")
    .map((part) => part.trim())
    .find((part) => part.length > 0);

const getRequestOrigin = (request: Request): string => {
  const requestUrl = new URL(request.url);
  const forwardedHost = firstForwardedHeaderValue(request.headers.get("x-forwarded-host"));
  const forwardedProto = firstForwardedHeaderValue(request.headers.get("x-forwarded-proto"));

  if (forwardedHost) {
    return `${forwardedProto ?? requestUrl.protocol.replace(":", "")}://${forwardedHost}`;
  }

  return requestUrl.origin;
};

export const isCsrfProtectedProxyRequestAllowed = (request: Request): boolean => {
  const normalizedMethod = request.method.toUpperCase();
  if (CSRF_SAFE_METHODS.has(normalizedMethod)) return true;

  const secFetchSite = request.headers.get("sec-fetch-site")?.toLowerCase();
  if (secFetchSite === "cross-site") return false;

  const origin = request.headers.get("origin");
  if (!origin) return true;

  try {
    return new URL(origin).origin === getRequestOrigin(request);
  } catch {
    return false;
  }
};

const proxyRequest = async (request: Request, context: RouteContext): Promise<Response> => {
  const { path } = await context.params;
  const incomingUrl = new URL(request.url);
  const apiPath = `/api/${path.join("/")}`;

  if (isProdReadOnlyMode() && !isReadOnlyProxyRequestAllowed(request.method, apiPath)) {
    return readOnlyResponse();
  }

  if (!isCsrfProtectedProxyRequestAllowed(request)) {
    return csrfResponse();
  }

  const targetUrl = new URL(`${apiPath}${incomingUrl.search}`, getBackendUrl());
  const headers = new Headers(request.headers);
  const apiAuthToken = getApiAuthToken();

  headers.delete("connection");
  headers.delete("content-length");
  headers.delete("host");

  if (apiAuthToken) {
    headers.set("authorization", `Bearer ${apiAuthToken}`);
  }

  const init: RequestInit & { duplex?: "half" } = {
    method: request.method,
    headers,
    redirect: "manual",
  };

  if (request.method !== "GET" && request.method !== "HEAD") {
    init.body = request.body;
    init.duplex = "half";
  }

  const response = await fetch(targetUrl, init);
  const responseHeaders = new Headers(response.headers);
  responseHeaders.delete("content-encoding");
  responseHeaders.delete("content-length");
  responseHeaders.delete("transfer-encoding");

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: responseHeaders,
  });
};

export const GET = proxyRequest;
export const POST = proxyRequest;
export const PATCH = proxyRequest;
export const PUT = proxyRequest;
export const DELETE = proxyRequest;
