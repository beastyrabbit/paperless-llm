/**
 * Application entry point.
 */
import { Effect, pipe, Layer } from 'effect';
import { createHttpServer } from './server.js';
import { AppLayer } from './layers/index.js';

const PORT = parseInt(process.env['PORT'] ?? '8765', 10);

const main = Effect.gen(function* () {
  console.log('Starting Paperless Local LLM TypeScript Backend...');
  console.log(`Environment: ${process.env['NODE_ENV'] ?? 'development'}`);

  const cleanup = yield* createHttpServer(PORT);

  // Handle graceful shutdown
  process.on('SIGINT', () => {
    console.log('\nShutting down...');
    cleanup();
    process.exit(0);
  });

  process.on('SIGTERM', () => {
    console.log('\nShutting down...');
    cleanup();
    process.exit(0);
  });

  // Keep the process running
  yield* Effect.never;
});

// Run the application
Effect.runPromise(
  pipe(main, Effect.provide(AppLayer))
).catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
