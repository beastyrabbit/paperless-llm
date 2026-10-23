# Release checks

`release-images.yml` accepts stable `vX.Y.Z` tags, including when dispatched manually.
Before either production image publishes, it waits up to ten minutes for the newest
`pr.yml` run with event `push`, branch `main`, and the checked-out commit SHA to
complete successfully. A failed or cancelled newest run blocks publishing even if
an older run succeeded. API errors fail immediately. The gate logs the run URL.

Both images receive `APP_VERSION` and the full `APP_REVISION`. The frontend bakes
them into its Next.js build. The backend stores them in the image environment.
Turbo includes both values and `NEXT_PUBLIC_APP_VERSION` in build cache keys.
`GET /version` reports frontend metadata, while backend `GET /api/version` reports
backend metadata. Both responses use `Cache-Control: no-store`.

After both images publish, the tag workflow runs on `arc-paperless-llm` and checks
`http://paperless-local-llm.documents.svc.cluster.local:3765`. The Service exposes
only port 3765, so `/api/version` reaches the backend through the frontend proxy.
The job retries Service reachability for up to five minutes to allow Recreate
rollouts, then polls for both version and revision matches. Both phases share a
25-minute deadline. A higher stable version ends the check as
`superseded`, with no claim that this release deployed. After a match, it requests
the standalone `/privacy` HTML page. All requests are GETs. The check never starts
document processing or inference.

Run mocked gate and poller tests with Node 22:

```sh
node --experimental-strip-types --test scripts/release/*.test.mts
```

Operational follow-up, confirmed on 2026-10-22:

- Re-enable **Pull Request Checks** in GitHub. Its state is `disabled_manually`;
  editing YAML does not enable it. Protect `main` with the quality check.
- `v0.9.2` and `release/0.9.x` both point to
  `5ad99a09aab5d37b07f21f1ba59f1dd013e4aec4`. That maintenance branch still uses
  the ungated `.github/workflows/docker-publish.yml`. This change does not backport
  fixes or alter maintenance tags.
- The Service name and port were confirmed in the homelab HelmRelease and the
  live Service. A GET of `/privacy` succeeded from `buildkitd-0` in `arc-runners`.
  No ephemeral `arc-paperless-llm` runner was active during inspection; the smoke
  job checks reachability from its own runner before polling.
- GitHub authentication now works. If the previous 401 returns, run
  `gh auth login -h github.com`.
