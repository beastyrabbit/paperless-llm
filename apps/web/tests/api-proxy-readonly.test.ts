import { afterEach, describe, expect, it, vi } from "vitest";

const originalEnv = { ...process.env };

const routeContext = (path: string[]) => ({
  params: Promise.resolve({ path }),
});

const importProxyRoute = async () => import("../app/api/[...path]/route");

describe("API proxy read-only mode", () => {
  afterEach(() => {
    process.env = { ...originalEnv };
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("blocks mutating requests before they reach the backend", async () => {
    process.env.PAPERLESS_LLM_PROD_READ_ONLY = "true";
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const route = await importProxyRoute();
    const response = await route.POST(
      new Request("http://paperless-llm-web.localhost/api/processing/123", { method: "POST" }),
      routeContext(["processing", "123"]),
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      status: 403,
      error: "Read Only Mode",
    });

    await expect(
      route.POST(
        new Request("http://paperless-llm-web.localhost/api/processing/123/cancel", {
          method: "POST",
        }),
        routeContext(["processing", "123", "cancel"]),
      ),
    ).resolves.toMatchObject({ status: 403 });

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("blocks GET endpoints that trigger processing or local config import", async () => {
    process.env.PAPERLESS_LLM_PROD_READ_ONLY = "true";
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const route = await importProxyRoute();

    await expect(
      route.GET(
        new Request("http://paperless-llm-web.localhost/api/processing/123/stream"),
        routeContext(["processing", "123", "stream"]),
      ),
    ).resolves.toMatchObject({ status: 403 });

    await expect(
      route.GET(
        new Request("http://paperless-llm-web.localhost/api/cases/document/123/stream"),
        routeContext(["cases", "document", "123", "stream"]),
      ),
    ).resolves.toMatchObject({ status: 403 });

    await expect(
      route.GET(
        new Request("http://paperless-llm-web.localhost/api/settings/check-import"),
        routeContext(["settings", "check-import"]),
      ),
    ).resolves.toMatchObject({ status: 403 });

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("allows frozen analysis/catalog GET routes without turning them into commands", async () => {
    process.env.PAPERLESS_LLM_PROD_READ_ONLY = "true";
    process.env.BACKEND_URL = "https://paperless-llm-api.example";
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ items: [], page: { nextCursor: null, hasNextPage: false, limit: 25 } }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const route = await importProxyRoute();

    await route.GET(
      new Request("http://paperless-llm-web.localhost/api/analysis/review?limit=25"),
      routeContext(["analysis", "review"]),
    );
    await route.GET(
      new Request("http://paperless-llm-web.localhost/api/analysis/failed?limit=25"),
      routeContext(["analysis", "failed"]),
    );
    await route.GET(
      new Request("http://paperless-llm-web.localhost/api/catalog/epochs?limit=25"),
      routeContext(["catalog", "epochs"]),
    );

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(
      fetchMock.mock.calls.map(([targetUrl, init]) => [(targetUrl as URL).pathname, init?.method]),
    ).toEqual([
      ["/api/analysis/review", "GET"],
      ["/api/analysis/failed", "GET"],
      ["/api/catalog/epochs", "GET"],
    ]);
  });

  it("blocks frozen analysis/catalog command routes in read-only mode", async () => {
    process.env.PAPERLESS_LLM_PROD_READ_ONLY = "true";
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const route = await importProxyRoute();

    await expect(
      route.POST(
        new Request("http://paperless-llm-web.localhost/api/analysis/runs", {
          method: "POST",
        }),
        routeContext(["analysis", "runs"]),
      ),
    ).resolves.toMatchObject({ status: 403 });
    await expect(
      route.POST(
        new Request("http://paperless-llm-web.localhost/api/catalog/epochs", {
          method: "POST",
        }),
        routeContext(["catalog", "epochs"]),
      ),
    ).resolves.toMatchObject({ status: 403 });
    await expect(
      route.POST(
        new Request("http://paperless-llm-web.localhost/api/catalog/proposals/prop_1/apply", {
          method: "POST",
        }),
        routeContext(["catalog", "proposals", "prop_1", "apply"]),
      ),
    ).resolves.toMatchObject({ status: 403 });

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("allows reads and forwards the backend auth header", async () => {
    process.env.PAPERLESS_LLM_PROD_READ_ONLY = "true";
    process.env.BACKEND_URL = "https://paperless-llm-api.example";
    process.env.PAPERLESS_LLM_API_TOKEN = "secret";
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: {
          "content-length": "11",
          "content-type": "application/json",
        },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const route = await importProxyRoute();
    const response = await route.GET(
      new Request("http://paperless-llm-web.localhost/api/documents/123?expand=true", {
        method: "GET",
        headers: {
          connection: "keep-alive",
          host: "paperless-llm-web.localhost",
        },
      }),
      routeContext(["documents", "123"]),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [targetUrl, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(targetUrl.toString()).toBe(
      "https://paperless-llm-api.example/api/documents/123?expand=true",
    );
    expect(init.method).toBe("GET");
    expect(init.headers).toBeInstanceOf(Headers);
    expect((init.headers as Headers).get("authorization")).toBe("Bearer secret");
    expect((init.headers as Headers).get("host")).toBeNull();
  });

  it("allows explicit safe connection-test probes in read-only mode", async () => {
    process.env.PAPERLESS_LLM_PROD_READ_ONLY = "true";
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ status: "success" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const route = await importProxyRoute();
    const response = await route.POST(
      new Request("http://paperless-llm-web.localhost/api/settings/test-connection/paperless", {
        method: "POST",
        headers: { origin: "http://paperless-llm-web.localhost" },
      }),
      routeContext(["settings", "test-connection", "paperless"]),
    );

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await expect(
      route.POST(
        new Request("http://paperless-llm-web.localhost/api/settings/test-connection/qdrant", {
          method: "POST",
          headers: { origin: "http://paperless-llm-web.localhost" },
        }),
        routeContext(["settings", "test-connection", "qdrant"]),
      ),
    ).resolves.toMatchObject({ status: 403 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("allows same-origin mutating proxy requests", async () => {
    process.env.BACKEND_URL = "http://localhost:8765";
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const route = await importProxyRoute();
    const response = await route.POST(
      new Request("https://paperless-llm-web.localhost:1355/api/documents/123/process", {
        method: "POST",
        headers: { origin: "https://paperless-llm-web.localhost:1355" },
      }),
      routeContext(["documents", "123", "process"]),
    );

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("uses forwarded host and proto when validating same-origin mutations", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);

    const route = await importProxyRoute();
    const response = await route.PATCH(
      new Request("http://127.0.0.1:3000/api/settings", {
        method: "PATCH",
        headers: {
          origin: "https://paperless-llm-web.localhost:1355",
          "x-forwarded-host": "paperless-llm-web.localhost:1355",
          "x-forwarded-proto": "https",
        },
      }),
      routeContext(["settings"]),
    );

    expect(response.status).toBe(204);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("rejects cross-site mutating proxy requests before they reach the backend", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const route = await importProxyRoute();
    const response = await route.DELETE(
      new Request("http://localhost:3765/api/documents/123", {
        method: "DELETE",
        headers: { origin: "https://attacker.example" },
      }),
      routeContext(["documents", "123"]),
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      status: 403,
      error: "CSRF Protection",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects fetch metadata cross-site mutations even without an origin header", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const route = await importProxyRoute();
    const response = await route.POST(
      new Request("http://localhost:3765/api/documents/123", {
        method: "POST",
        headers: { "sec-fetch-site": "cross-site" },
      }),
      routeContext(["documents", "123"]),
    );

    expect(response.status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
