# W3-S15 `.ref/` Policy Worker Handoff

## Implemented

- Updated `docs/plans/audit-rework-tasks.md` W3-S15 to reflect the selected policy: keep `.ref/` as an ignored local-only reference tree instead of deleting it or converting it to a submodule.
- Marked the `.ref/` checklist item complete under the new policy wording.
- Added a W3-S15 note documenting that `.ref/` may exist locally only for upstream reference, must remain ignored by `.gitignore` and `.dockerignore`, and must not leak into committed/build artifacts.
- Added the existing artifact guard to PR CI:
  - `.github/workflows/pr.yml` now runs `pnpm run check:ref-artifacts` after unit tests.

## Changed files

- `docs/plans/audit-rework-tasks.md`
- `.github/workflows/pr.yml`
- `subagent-reports/w3-s15-ref-policy-worker.md`

## Validation

- `pnpm run check:ref-artifacts` — passed.
- `git check-ignore -v .ref` — passed; `.ref` is ignored by `.gitignore:92:.ref/`.
- Workflow guard check — passed; `.github/workflows/pr.yml` contains `Check reference artifacts` and `pnpm run check:ref-artifacts`.

## Notes / risks

- `.ref/` was not deleted and was not converted to a submodule, per policy.
- The artifact guard scans existing build artifact directories and is safe when they are absent.
