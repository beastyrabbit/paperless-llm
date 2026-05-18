# Todo #38 / W4-S18 handoff: config-driven full-pipeline step limit

## Requirement
Move the hard-coded SSE full-pipeline `MAX_PIPELINE_STEPS` into backend config and document it with a comment. No behavior change except allowing config override.

## Config name/default
- Use `pipeline.maxSteps` in TypeScript / resolved config.
- YAML key should be `pipeline.max_steps` (normalize to `maxSteps`) to match existing snake_case examples.
- Default: `10`.
- Comment text for examples/default vicinity: `# Safety bound against infinite workflow loops in full-pipeline SSE processing.`

## Relevant code evidence
- `apps/backend/src/server.ts:272-274` already loads `ConfigService` in the SSE effect and uses `configService.config.tags`.
- `apps/backend/src/server.ts:389-400` defines and uses the magic number:
  - `const MAX_PIPELINE_STEPS = 10;`
  - loop condition `iterationCount < MAX_PIPELINE_STEPS`.
- `apps/backend/src/server.ts:457-464` uses the same constant for the guard error: `Pipeline exceeded maximum step count - possible infinite loop`.
- `apps/backend/src/config/schema.ts:67-77` defines `PipelineConfigSchema`; add optional `maxSteps: Schema.Number` there.
- `apps/backend/src/config/schema.ts:167-176` defines `ResolvedConfig.pipeline`; add `maxSteps: number` there.
- `apps/backend/src/config/index.ts:64-73` defines `defaultConfig.pipeline`; add `maxSteps: 10` with the safety-bound comment. `applyDefaults` at `index.ts:136-139` already merges partial pipeline config, so no special merge logic needed.
- `apps/backend/src/config/yaml-loader.ts:91-110` shows normalization style for snake_case keys in nested sections. Add a `pipeline` normalization block for `max_steps -> maxSteps` before validation.
- `config.example.yaml:70-79` and `config.prod.readonly.example.yaml:47-55` have tracked `pipeline:` sections; add `max_steps: 10` plus the safety-bound comment in both.

## Tests to add/update
- `apps/backend/tests/config/config.test.ts` is the right place for config default/YAML behavior. Add a focused test that writes `pipeline:\n  max_steps: 4`, runs `makeConfigService()`, and expects `service.config.pipeline.maxSteps === 4`. Also assert default is `10` in the existing defaults test or a small new test.
- `apps/backend/tests/server.test.ts:203-278` has the existing full=true SSE test with a stub `ConfigService` containing only `tags`. After adding required `pipeline.maxSteps`, update that stub to include `pipeline: { maxSteps: 10 }` (or cast with a fuller config). Add a second SSE test if practical: set `pipeline.maxSteps: 1`, return a document state that remains non-terminal after one step, and assert the SSE body contains the max-step error while `processStepStream` is called once.

## Implementation notes / risks
- Prefer `const maxPipelineSteps = configService.config.pipeline.maxSteps;` near `tagConfig` or inside `if (fullPipeline)`; replace both uses of `MAX_PIPELINE_STEPS` with it.
- Keep the scope to the SSE full-pipeline loop only; `ProcessingPipeline.ts` has independent pipeline step policy and should not be refactored for this todo.
- Existing examples use legacy YAML keys (`ocr`, `document_type`, etc.) while `PipelineConfigSchema` uses `enableOcr`, etc.; do not broaden this task beyond adding `max_steps` normalization unless tests reveal validation problems.
- No env var is required by the task. If adding one, keep it additive (e.g. `PAPERLESS_LLM_PIPELINE_MAX_STEPS`) and test it, but the minimal path is YAML/default only.

## Validation
Run targeted backend checks:
- `pnpm --filter @paperless-llm/backend test -- tests/config/config.test.ts tests/server.test.ts`
- `pnpm --filter @paperless-llm/backend typecheck`
If filter script names differ, use the repo-standard backend commands: `pnpm run test` and `pnpm run typecheck` from `apps/backend` or root.

## Compact worker prompt
Implement Todo #38 only. Add `pipeline.maxSteps` (default `10`) to backend config schema/resolved defaults with a comment that it is a safety bound against infinite workflow loops. Normalize YAML `pipeline.max_steps` to `maxSteps`. Use `configService.config.pipeline.maxSteps` in `apps/backend/src/server.ts` instead of the local `MAX_PIPELINE_STEPS` constant for the full=true SSE loop and max-iteration error. Update `config.example.yaml` and `config.prod.readonly.example.yaml`. Add/adjust config and SSE tests as above. Keep behavior unchanged when config is absent; do not refactor unrelated pipeline/tag code.
