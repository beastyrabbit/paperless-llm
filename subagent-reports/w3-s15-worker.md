# W3-S15 Clean Repository Weight Handoff

## Changed files

- `.dockerignore`
  - Added `.ref/` to Docker context exclusions.
  - Added root screenshot/image exclusions (`/*.png`) plus `screenshots/` and `**/screenshots/`.
  - Added additional secret/certificate key patterns: `*.key`, `*.crt`, `*.p12`.
  - Preserved the pre-existing dirty change that allows `!.env*.example`.
- `docs/images/documents-741-after-wait.png`
  - Moved from repository root.
- `docs/images/documents-741-structured-case.png`
  - Moved from repository root.

## Local cleanup performed

- Removed local ignored `tsconfig.tsbuildinfo` from the working tree. The repo already ignores `*.tsbuildinfo` in both `.gitignore` and `.dockerignore`.
- Root PNG check now returns no root-level `*.png` files.

## Decisions / notes

- Did **not** delete `.ref/`. It is an ignored local vendored/reference tree of about `1.9G` with upstream sources (`pi`, `paperless-ngx`, `openclaw`, etc.). Deleting or converting this to a submodule is a repository/product policy decision, so the safest implementation was to ensure it remains out of Git and Docker build context and document the remaining decision.
- `.gitignore` was already dirty before this worker's edits with an `!.env*.example` change; it was not edited by this worker.
- Requested `context.md` and `plan.md` were not present in the repository root when read attempts were made; implementation used `docs/plans/audit-rework-tasks.md` and `subagent-reports/w4-polish-context.md`.

## Commands run

- `git status --short --ignored=matching .ref '*.png' tsconfig.tsbuildinfo .dockerignore docs/images subagent-reports/w3-s15-worker.md`
- `find . -maxdepth 2 -type f -name '*.png' -printf '%p %k KB\n'`
- `du -sh .ref`
- `git diff -- .dockerignore`
- `git diff -- .gitignore`
- `git ls-files .ref; git ls-files '*.png' 'tsconfig.tsbuildinfo' '.dockerignore' '.gitignore' docs/images/*.png`
- `mv documents-741-after-wait.png docs/images/documents-741-after-wait.png`
- `mv documents-741-structured-case.png docs/images/documents-741-structured-case.png`
- `rm -f tsconfig.tsbuildinfo`
- `pnpm run check:ref-artifacts`
- `find . -maxdepth 1 -type f -name '*.png' -print`
- `ls -lh docs/images/documents-741-*.png`
- `git check-ignore -v .ref tsconfig.tsbuildinfo documents-foo.png screenshots/foo.png .env config.yaml secret.key secret.crt secret.p12 2>&1 || true`

## Validation

- `pnpm run check:ref-artifacts` passed.
- `find . -maxdepth 1 -type f -name '*.png' -print` produced no output.
- `git status --short --ignored=matching .ref tsconfig.tsbuildinfo docs/images/documents-741-after-wait.png docs/images/documents-741-structured-case.png .dockerignore .gitignore` showed:
  - `.dockerignore` modified by this worker.
  - new PNGs under `docs/images/`.
  - `.ref/` ignored.
  - `.gitignore` still dirty from pre-existing unrelated change.

## Remaining risks / follow-up

- W3-S15's `.ref/` checklist item is not fully resolved until maintainers choose a policy: remove local reference sources, move them outside the repo, or convert selected upstreams to submodules/subtrees. Current state prevents accidental Git/Docker inclusion but leaves the local 1.9G directory on disk.
- The moved PNGs are untracked and need to be added by the parent/main writer if they should remain as documentation images.
