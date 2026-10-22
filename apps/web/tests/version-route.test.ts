// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { dynamic, GET } from "../app/version/route";

afterEach(() => vi.unstubAllEnvs());

describe("frontend version endpoint", () => {
  it("reports frontend metadata without calling the backend and disables caching", async () => {
    vi.stubEnv("APP_VERSION", "1.2.3");
    vi.stubEnv("APP_REVISION", "a".repeat(40));
    const fetch = vi.spyOn(globalThis, "fetch");
    const response = GET();
    expect(dynamic).toBe("force-dynamic");
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toEqual({ version: "1.2.3", revision: "a".repeat(40) });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("uses explicit development metadata outside release builds", async () => {
    vi.stubEnv("APP_VERSION", undefined);
    vi.stubEnv("APP_REVISION", undefined);
    expect(await GET().json()).toEqual({ version: "dev", revision: "unknown" });
  });
});
