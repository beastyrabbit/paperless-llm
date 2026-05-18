/**
 * Application entry point.
 */
import { Effect, pipe } from "effect";
import { AppLayer } from "./layers/index.js";
import { createHttpServer } from "./server.js";
import { logger } from "./utils/logger.js";

const PORT = parseInt(process.env["PORT"] ?? "8765", 10);
const HOST =
  process.env["HOST"] ?? (process.env["NODE_ENV"] === "production" ? "0.0.0.0" : "127.0.0.1");
const startupLogger = logger.child({ component: "process" });

let cleanupServer: (() => void) | null = null;

const runCleanup = () => {
  try {
    cleanupServer?.();
  } catch (error) {
    startupLogger.error("shutdown_cleanup_failed", { error });
  } finally {
    cleanupServer = null;
  }
};

process.on("unhandledRejection", (reason) => {
  startupLogger.fatal("unhandled_rejection", { error: reason });
  runCleanup();
  process.exit(1);
});

process.on("uncaughtException", (error) => {
  startupLogger.fatal("uncaught_exception", { error });
  runCleanup();
  process.exit(1);
});

const main = Effect.gen(function* () {
  startupLogger.info("backend_starting", {
    environment: process.env["NODE_ENV"] ?? "development",
  });

  const cleanup = yield* createHttpServer(PORT, HOST);
  cleanupServer = cleanup;

  // Handle graceful shutdown
  process.on("SIGINT", () => {
    startupLogger.info("shutdown_requested", { signal: "SIGINT" });
    runCleanup();
    process.exit(0);
  });

  process.on("SIGTERM", () => {
    startupLogger.info("shutdown_requested", { signal: "SIGTERM" });
    runCleanup();
    process.exit(0);
  });

  // Keep the process running
  yield* Effect.never;
});

// Run the application
Effect.runPromise(pipe(main, Effect.provide(AppLayer))).catch((error) => {
  startupLogger.fatal("startup_failed", { error });
  process.exit(1);
});
