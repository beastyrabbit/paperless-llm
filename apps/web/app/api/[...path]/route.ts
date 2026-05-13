const BACKEND_URL = process.env.BACKEND_URL || "http://localhost:8765";
const API_AUTH_TOKEN = process.env.PAPERLESS_LLM_API_TOKEN ?? process.env.LOCAL_LLM_API_KEY ?? "";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ path: string[] }>;
};

const proxyRequest = async (request: Request, context: RouteContext): Promise<Response> => {
  const { path } = await context.params;
  const incomingUrl = new URL(request.url);
  const targetUrl = new URL(`/api/${path.join("/")}${incomingUrl.search}`, BACKEND_URL);
  const headers = new Headers(request.headers);

  headers.delete("connection");
  headers.delete("content-length");
  headers.delete("host");

  if (API_AUTH_TOKEN) {
    headers.set("authorization", `Bearer ${API_AUTH_TOKEN}`);
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
