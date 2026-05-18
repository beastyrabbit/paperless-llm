# Todo #13 / W3-S14: implementation-ready handoff — interrupt SSE loops on client close

## Scope inspected

Backend SSE endpoints are implemented directly in `apps/backend/src/server.ts`, not via `apps/backend/src/api/*/handlers.ts` route handlers. The three relevant paths are:

- Processing: `GET /api/processing/:docId/stream`
- Case snapshot polling: `GET /api/cases/document/:docId/stream`
- Catalog run log polling: `GET /api/catalog/runs/:runId/stream`

Frontend clients create `EventSource`s and already close them on cleanup in at least one hook, but server-side close handling is incomplete.

## Key files and evidence

### `apps/backend/src/server.ts`

- SSE URL patterns are defined at lines 126-128:
  - `SSE_STREAM_PATTERN = /^\/api\/processing\/(\d+)\/stream$/`
  - `CASE_STREAM_PATTERN = /^\/api\/cases\/document\/(\d+)\/stream$/`
  - `CATALOG_STREAM_PATTERN = /^\/api\/catalog\/runs\/([^/]+)\/stream$/`
- `delay` is a plain non-abortable promise at line 73: `const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));`
- Runtime bridge currently only exposes promise execution, with no cancellation hook, lines 239-240:
  - `Runtime.runPromise(runtime)(effect as Effect.Effect<A, never, never>)`
- Processing SSE helper `handleSSEStream` starts at lines 243-533:
  - sets SSE headers at 257-260;
  - `sendEvent` blindly writes at 268-270;
  - full-pipeline branch drains `pipeline.processDocumentStream` at 273-288;
  - single/loop step branches drain `pipeline.processStepStream` at 432-463 and 492-508;
  - always calls `res.end()` in `finally` at 530-531.
- Processing route invokes `await handleSSEStream(...)` at lines 580-592, with no `req.on("close")` handling and no interruption of the active Effect fiber. If the browser closes the EventSource during OCR/LLM/pipeline streaming, the server continues running until the Effect completes and continues trying to write to a closed response.
- Case stream route lines 594-638:
  - does set `let closed = false` and `req.on("close", () => { closed = true; })` at 605-608;
  - loops `while (!closed)` at 610;
  - each iteration awaits `runWithRuntime(...)`, writes data and keep-alive at 625-626, then awaits non-abortable `delay(2000)` at 627;
  - current close handling only stops before the next loop iteration. It does not abort an in-flight `runWithRuntime` or the 2s delay, and writes do not check `closed` after the runtime call returns.
- Catalog stream route lines 640-679 has the same pattern as case stream:
  - `closed` flag and close listener at 646-649;
  - `while (!closed)` at 651;
  - awaits `runWithRuntime(...)`, writes at 666-667, then non-abortable `delay(2000)` at 668;
  - no in-flight Effect/delay cancellation and no post-await closed check before writes.
- Read-only mode currently blocks only processing SSE, not case/catalog SSE, in backend lines 145-148. This is probably separate from this task unless worker is asked to address read-only parity.

### `apps/web/lib/api.ts`

- Processing EventSource factory lines 314-321. It supports `full` and `dryRun` query params; `step` is accepted in the client API but server ignores it for SSE.
- Cases EventSource factory line 359: `/api/cases/document/${docId}/stream`.
- Catalog API currently has REST log methods at lines 383-386 but no frontend EventSource factory for `/api/catalog/runs/:runId/stream`, even though backend serves it.

### `apps/web/lib/tinybase/hooks/useProcessingLogs.ts`

- `useProcessingStream` creates an EventSource at lines 116-120.
- Cleanup closes the EventSource at lines 145-147. This means the server must treat client close as authoritative and interrupt backend work.

### `apps/backend/tests/server.test.ts`

- Existing tests cover exported server helper functions only (`isAuthorized`, CORS origins, read-only helpers), lines 1-92.
- No current harness exercises live SSE routes or client disconnect behavior.

### Next.js proxy: `apps/web/app/api/[...path]/route.ts`

- Proxy streams backend response bodies through `new Response(response.body, ...)` at lines 87-97.
- Read-only proxy blocks processing SSE at lines 23-25; case/catalog SSE are not blocked. Likely out of scope, but note for parity if read-only paths are touched.

## Problem statement

Processing SSE has no client-close detection at all. Case/catalog streams detect close only at loop boundaries, not while a runtime effect is running or while sleeping. All three should stop promptly when the client closes the HTTP connection/EventSource. For processing this should interrupt the Effect fiber that is draining `processDocumentStream`/`processStepStream`; simply setting a boolean is insufficient because pipeline work may be long-running or expensive.

## Suggested design

Implement a small reusable close/cancellation pattern in `apps/backend/src/server.ts` and apply it to all three SSE branches.

1. Add an abort/close signal per SSE request.
   - Use `const abortController = new AbortController();`
   - On `req.on("close", ...)`, abort once.
   - Optionally also listen to `res.on("close", ...)`; in Node HTTP this can fire when the underlying connection terminates. Guard against double abort.
   - Track `closed = abortController.signal.aborted` or helper `isClosed()`.

2. Replace `runWithRuntime` for SSE work with an interruptible runtime runner.
   - Effect 3.19.14 exposes `Runtime.runFork` and fibers expose interruption APIs (`node_modules/.pnpm/effect@3.19.14/.../Runtime.d.ts`, `Fiber.d.ts`).
   - Import likely additions: `Fiber` from `effect` or use the runtime fiber’s `unsafeInterruptAsFork`/`interruptAsFork` methods. Verify with typecheck.
   - Helper shape:
     - fork the Effect with `Runtime.runFork(runtime, effect as ...)`;
     - on abort, interrupt the fiber (`Runtime.runPromise(runtime)(Fiber.interruptFork(fiber))` or `fiber.unsafeInterruptAsFork(...)` depending on chosen API);
     - await `fiber.await` / completion through runtime, converting normal failures consistently with current `runWithRuntime` behavior;
     - remove abort listener in `finally`.
   - Alternative if Effect `Runtime.runPromise` supports AbortSignal in this version: verify types before using; local `Runtime.d.ts` shows `runFork` clearly, so forking is the safest implementation path.

3. Make response writes safe.
   - Centralize `sendSse(res, signal, payload)` and `sendKeepAlive(...)` helpers.
   - Check `signal.aborted || res.destroyed || res.writableEnded` before writing.
   - Handle `res.write()` returning false only if needed; core requirement is not writing after close.
   - Do not send error events after close. Existing catch blocks should guard `if (!signal.aborted)`.
   - In `finally`, call `res.end()` only if not already ended/destroyed; avoid throwing on closed sockets.

4. Make polling sleeps abortable for case/catalog.
   - Replace `delay(2000)` with `delay(2000, signal)` or a `waitForCloseOrTimeout(signal, 2000)` promise that resolves immediately on abort.
   - In case/catalog loops, after `await runWithRuntimeInterruptible(...)`, re-check closed before writing.

5. Processing-specific application.
   - Change `handleSSEStream` signature to include `req` or an `AbortSignal`, e.g. `handleSSEStream(req, res, docId, ...)` or create signal in route and pass it in.
   - Full-pipeline branch lines 273-288 and step-stream branches lines 432-463 / 492-508 should run through the interruptible runner, so client close interrupts `Stream.runDrain` and the pipeline stream.
   - `sendEvent` should be signal-aware and should not throw/write after close.

6. Case/catalog-specific application.
   - Reuse the same signal and interruptible runner for each loop iteration.
   - Loop condition should be `while (!signal.aborted)`.
   - If abort happens during the TinyBase/case lookup, interrupt that effect and exit without writing.

## Risks and constraints

- Do not change pipeline semantics: client close should stop only that SSE request/fiber. It should not globally stop auto-processing or unrelated jobs.
- Interrupting processing SSE may interrupt a user-initiated `processDocumentStream` / `processStepStream`. That is desired for this ticket, but worker should verify lock/finalizer cleanup in the pipeline still runs under Effect interruption.
- Avoid swallowing real errors while connection is open; still log/send SSE error as today when not aborted.
- Do not add PromptService or prompt-file driven paths. Project rule requires Pi agent instructions/tools/schemas in TypeScript only; this task should stay in server/test code.
- Catalog backend stream exists, but frontend has no EventSource factory. Do not expand frontend API unless requested; focus is server interruption.

## Test / harness ideas

Preferred targeted tests:

1. Unit-test exported helpers if they are factored out.
   - Export small helpers from `server.ts` only if acceptable, e.g. `createCloseSignal`, `abortableDelay`, `isSseWritable`, or an interruptible runner wrapper.
   - Add tests in `apps/backend/tests/server.test.ts` near existing helper tests.
   - Test abortable delay resolves promptly when signal aborts (use Vitest fake timers or a short timeout).

2. Live HTTP harness for case/catalog close behavior.
   - Harder because `createHttpServer` builds `AppLayer` and real services. If feasible, start server on ephemeral port (`0`) is not currently supported by returned cleanup only; `createHttpServer(port)` hides the `server` instance, so this may require refactor to make testing practical.
   - If not feasible, keep helper-level tests plus manual curl harness below.

3. Processing interruption harness idea.
   - If factoring makes it testable, inject a never-ending Effect/Stream into the interruptible runner, abort signal, and assert the fiber finalizer runs.
   - Use `Effect.addFinalizer` / `Effect.acquireRelease` around `Effect.never` or `Stream.never` to set a flag on interruption.

Manual validation harness:

- Run backend: `pnpm run dev:backend`.
- Open an SSE stream, then close quickly:
  - `curl -N http://localhost:8765/api/cases/document/1/stream` then Ctrl-C; server should stop loop immediately and not log repeated writes.
  - `curl -N http://localhost:8765/api/catalog/runs/test/stream` then Ctrl-C; same.
  - For processing: `curl -N 'http://localhost:8765/api/processing/1/stream?full=true'` then Ctrl-C during work; server should log/stop promptly and not continue processing that SSE pipeline.
- Suggested instrumentation while developing: temporary debug logs on close/abort/fiber interruption, removed or reduced before commit.

Validation commands:

- `pnpm --filter @repo/backend test -- server.test.ts` if package filters are configured; otherwise run backend tests per project scripts.
- `pnpm run test` from repo or `apps/backend` context depending on current script behavior.
- `pnpm run typecheck`.
- `pnpm run lint`.

## Compact worker prompt

Implement server-side interruption for SSE streams on client disconnect. In `apps/backend/src/server.ts`, make processing (`/api/processing/:docId/stream`), case (`/api/cases/document/:docId/stream`), and catalog (`/api/catalog/runs/:runId/stream`) SSE paths stop promptly when the client closes the connection. Processing currently has no close handling and drains Effect streams to completion; case/catalog only check a boolean between iterations and use a non-abortable 2s delay. Add a reusable AbortSignal/close helper, safe SSE write helpers, abortable delay, and an interruptible Effect runtime runner using Effect `Runtime.runFork`/fiber interruption so in-flight pipeline/case/catalog Effects are interrupted on close. Guard error sends and `res.end()` after close. Preserve existing response payload shapes and normal error behavior while connection is open. Add targeted tests for abortable delay and/or interruptible runner/finalizer behavior in `apps/backend/tests/server.test.ts` (or a small exported helper) and run backend tests, typecheck, and lint.

## Assumptions / open questions

- Assumption: Todo #13 is about backend resource cleanup, not frontend EventSource lifecycle, because frontend already closes processing EventSources on cleanup and backend is where loops/work continue.
- Open question for implementer: exact Effect API for promise conversion from `Runtime.runFork` should be verified by TypeScript. Local typings confirm `Runtime.runFork` exists and runtime fibers can be interrupted/awaited.
- Open question: whether read-only mode should also block case/catalog SSE. This was observed but is not necessary for SSE close interruption unless product owner expands scope.
