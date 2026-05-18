import type { HealthDependency, HealthResponse } from "@repo/api-contracts";
import { Effect } from "effect";
import {
  MistralService,
  OllamaService,
  PaperlessService,
  QdrantService,
} from "../../services/index.js";

const HEALTH_PROBE_TIMEOUT_MS = 5_000;

type DependencyName = "paperless" | "ollama" | "qdrant" | "mistral";

const dependencyLabels: Record<DependencyName, string> = {
  paperless: "Paperless",
  ollama: "Ollama",
  qdrant: "Qdrant",
  mistral: "Mistral",
};

const checkDependency = (
  name: DependencyName,
  run: Effect.Effect<boolean, unknown, unknown>,
): Effect.Effect<HealthDependency, never, unknown> =>
  Effect.gen(function* () {
    const started = Date.now();
    const ok = yield* run.pipe(
      Effect.timeoutFail({
        duration: `${HEALTH_PROBE_TIMEOUT_MS} millis`,
        onTimeout: () => new Error(`${name} health check timed out`),
      }),
      Effect.sandbox,
      Effect.match({
        onFailure: () => false,
        onSuccess: (value) => value,
      }),
    );

    return {
      status: ok ? "up" : "down",
      required: true,
      durationMs: Date.now() - started,
      ...(ok ? {} : { message: `${dependencyLabels[name]} health check failed` }),
    };
  });

export const getHealth: Effect.Effect<HealthResponse, never, unknown> = Effect.gen(function* () {
  const paperlessService = yield* PaperlessService;
  const ollamaService = yield* OllamaService;
  const qdrantService = yield* QdrantService;
  const mistralService = yield* MistralService;
  const started = Date.now();

  const [paperless, ollama, qdrant, mistral] = yield* Effect.all(
    [
      checkDependency("paperless", paperlessService.testConnection()),
      checkDependency("ollama", ollamaService.testConnection()),
      checkDependency("qdrant", qdrantService.testConnection()),
      checkDependency("mistral", mistralService.testConnection()),
    ],
    { concurrency: "unbounded" },
  );

  const services = { paperless, ollama, qdrant, mistral };
  const healthy = Object.values(services).every((service) => service.status === "up");

  return {
    status: healthy ? 200 : 503,
    health: healthy ? "healthy" : "unhealthy",
    timestamp: new Date().toISOString(),
    durationMs: Date.now() - started,
    services,
  };
});
