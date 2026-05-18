# Implementation Plan

## Goal
Resolve todo #18 / W3-S15 `.ref/` handling by documenting the selected policy: keep `.ref/` as an ignored, local-only reference tree and enforce that it never enters Git, Docker build context, or build artifacts.

## Findings

- `context.md` was not present at `/mnt/storage/workspace/projects/paperless_local_llm/context.md`; planning used the requested files and existing `subagent-reports/w3-s15-worker.md`.
- `docs/plans/audit-rework-tasks.md` still says W3-S15 should “Remove or submodule `.ref/` vendored upstream sources.” This conflicts with the user-selected policy to keep `.ref/` ignored.
- `.gitignore` already ignores `.ref/` and `*.tsbuildinfo`.
- `.dockerignore` already excludes `.ref/`, screenshots, root PNGs, build outputs, TypeScript build info, secrets/config, and other large paths.
- `scripts/check-ref-artifacts.sh` exists and fails if built artifacts under `apps/backend/dist` or `apps/web/.next` contain literal `.ref/` paths.
- Root `package.json` exposes `pnpm run check:ref-artifacts`, but `.github/workflows/pr.yml` does not currently run it.
- Existing W3-S15 handoff says `.ref/` is an ignored local reference tree (~1.9G) and was intentionally not deleted pending policy.

## Recommendation

Do **not** mark todo #18 blocked. The selected policy resolves the decision point. Add a small follow-up doc/script update that:

1. Records `.ref/` as an explicit W3-S15 policy exception in `docs/plans/audit-rework-tasks.md`.
2. Marks the `.ref/` checklist item complete under the new policy wording.
3. Adds `pnpm run check:ref-artifacts` to PR CI so ignored local references cannot leak into build outputs.

No repository source behavior changes are needed.

## Tasks

1. **Update W3-S15 checklist wording**
   - File: `docs/plans/audit-rework-tasks.md`
   - Changes: Replace `Remove or submodule .ref/ vendored upstream sources.` with wording such as `Keep .ref/ as an ignored local-only reference tree; exclude it from Git and Docker contexts and prevent build artifacts from referencing it.` Mark the item `[x]`.
   - Acceptance: W3-S15 no longer contradicts the selected “keep ignored” policy.

2. **Document the policy exception in W3-S15 acceptance/notes**
   - File: `docs/plans/audit-rework-tasks.md`
   - Changes: Add a short note under W3-S15 explaining that `.ref/` may exist locally for upstream reference only, must remain ignored by `.gitignore` and `.dockerignore`, and must not be imported/referenced by built artifacts.
   - Acceptance: A future contributor can understand why `.ref/` is not removed/submoduled.

3. **Wire artifact guard into CI**
   - File: `.github/workflows/pr.yml`
   - Changes: Add a step after `Typecheck`/`Build` if build outputs exist, or after `Test`, running `pnpm run check:ref-artifacts`. Because the script exits 0 when no target build directories exist, it is safe even if CI has not built both apps.
   - Acceptance: PR checks include the `.ref/` artifact guard.

4. **Optional local validation note**
   - File: `docs/plans/audit-rework-tasks.md`
   - Changes: In W3-S15 acceptance or notes, mention validation commands: `git check-ignore -v .ref`, `pnpm run check:ref-artifacts`.
   - Acceptance: Reviewers have explicit commands to confirm the policy.

## Files to Modify

- `docs/plans/audit-rework-tasks.md` - align W3-S15 `.ref/` item with the selected keep-ignored policy and mark it resolved.
- `.github/workflows/pr.yml` - add the existing `.ref/` artifact guard to CI.

## New Files

- None.

## Dependencies

- Task 2 depends on Task 1’s final wording.
- Task 3 is independent but should be part of the same small follow-up so the documented policy has enforcement beyond ignores.

## Risks

- `pnpm run check:ref-artifacts` currently only scans existing `apps/backend/dist` and `apps/web/.next`; if CI does not build those directories, the check passes by design. This is still useful as a guard after local/CI builds, but it is not a full source-level import check.
- Other reports already cite `.ref/...` paths as evidence. The policy should allow documentation references to `.ref/` while forbidding committed vendored content and build artifact references.
- If maintainers later decide `.ref/` must be absent from all developer machines, this plan should be reversed; under the current selected policy, it is not blocked.

## Exact Next Worker Prompt

```text
Implement todo #18 `.ref/` policy resolution. The selected policy is to keep `.ref/` ignored as a local-only vendored/reference tree, not remove it and not convert it to a submodule. Edit only documentation/CI as needed. Update `docs/plans/audit-rework-tasks.md` W3-S15 so the `.ref/` checklist item is marked complete under the new policy wording, and add a short policy exception note saying `.ref/` may exist locally but must remain ignored by `.gitignore`/`.dockerignore` and must not leak into build artifacts. Add `pnpm run check:ref-artifacts` to `.github/workflows/pr.yml` using the existing `scripts/check-ref-artifacts.sh`. Do not delete `.ref/`. Validate with `pnpm run check:ref-artifacts` and, if possible, `git check-ignore -v .ref`.
```
