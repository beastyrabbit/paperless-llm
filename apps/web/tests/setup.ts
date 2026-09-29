import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

class MockEventSource {
  readonly url: string;

  constructor(url: string) {
    this.url = url;
  }

  close() {
    // The test double has no connection to close.
  }
}

vi.stubGlobal("EventSource", MockEventSource);
