import { afterAll, beforeAll, vi } from "vitest";

beforeAll(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(() => {
      throw new Error("Live network is forbidden in tests; inject mocked fetch");
    }),
  );
});
afterAll(() => vi.unstubAllGlobals());
