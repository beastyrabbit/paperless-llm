# W3-S15 `.ref/` CI Guard Fix Worker Handoff

## Issue fixed

The PR workflow previously ran `pnpm run check:ref-artifacts` before any artifact-producing build step. Because `scripts/check-ref-artifacts.sh` only scans `apps/backend/dist` and `apps/web/.next` when those directories exist, the CI guard could pass as a no-op.

## Changes made

- Updated `.github/workflows/pr.yml` to run `pnpm build` before `pnpm run check:ref-artifacts`.
  - This makes CI produce `apps/backend/dist` and `apps/web/.next` before scanning them for `.ref/` path leaks.
  - The existing E2E step remains after the guard.
- Updated the W3-S15 note in `docs/plans/audit-rework-tasks.md` to state that CI builds artifacts before running the guard, and that local validation should run the guard after a build when artifact directories are present.
- Kept the selected `.ref/` policy intact: `.ref/` remains ignored/local-only and was not deleted or converted to a submodule.
- Runtime code was not changed.

## Changed files

- `.github/workflows/pr.yml`
- `docs/plans/audit-rework-tasks.md`
- `subagent-reports/w3-s15-ref-policy-ci-fix-worker.md`

## Validation

Passed:

```bash
pnpm run check:ref-artifacts

grep -n "Build artifacts for reference guard\|Check reference artifacts\|pnpm build\|check:ref-artifacts" .github/workflows/pr.yml
pnpm --filter @repo/backend exec node -e "const fs=require('fs'); const YAML=require('yaml'); YAML.parse(fs.readFileSync('../../.github/workflows/pr.yml','utf8')); console.log('workflow yaml parsed')"

pnpm build
pnpm run check:ref-artifacts
```

The local build produced backend/web artifacts successfully, and the post-build `.ref/` artifact scan passed.

## Notes / risks

- Adding `pnpm build` increases CI runtime, but it makes the documented artifact guard effective.
- The guard still intentionally scans build artifacts, not every source file; documentation references to `.ref/` remain allowed.
