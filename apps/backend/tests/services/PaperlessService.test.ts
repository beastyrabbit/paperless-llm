import { Effect, Layer } from "effect";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ConfigService } from "../../src/config/index.js";
import { PaperlessService, PaperlessServiceLive } from "../../src/services/PaperlessService.js";
import { TinyBaseService } from "../../src/services/TinyBaseService.js";

const createConfigLayer = (requestTimeoutMs = 1_000) =>
  Layer.succeed(ConfigService, {
    config: {
      paperless: {
        url: "http://paperless.test",
        token: "paperless-token",
      },
      tags: {},
      http: {
        requestTimeoutMs,
      },
    },
  } as unknown as ConfigService);

const createTinyBaseLayer = () =>
  Layer.succeed(TinyBaseService, {
    getAllSettings: vi.fn(() => Effect.succeed({})),
  } as unknown as TinyBaseService);

describe("PaperlessService", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("fails hanging Paperless endpoints within the configured timeout", async () => {
    const fetchMock = vi.fn(
      (_input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener(
            "abort",
            () => reject(init.signal?.reason ?? new Error("aborted")),
            { once: true },
          );
        }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const TestLayer = Layer.provideMerge(
      PaperlessServiceLive,
      Layer.mergeAll(createConfigLayer(5), createTinyBaseLayer()),
    );

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const paperless = yield* PaperlessService;
        return yield* Effect.either(paperless.getTags());
      }).pipe(Effect.provide(TestLayer)),
    );

    expect(result._tag).toBe("Left");
    if (result._tag === "Left") {
      expect(result.left.message).toContain("timed out");
    }
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
