# Release checks

The release workflow accepts stable vX.Y.Z tags. Before publishing the single
application image, it waits for the newest successful main-branch push check for
the checked-out revision. Failed or cancelled checks block publishing. API errors
fail immediately.

The container receives APP_VERSION and the full APP_REVISION. Both /version and
/api/version return the same build identity with Cache-Control: no-store.
The existing smoke poller requires both endpoints to match, then checks the
standalone /privacy HTML page. It never starts processing or inference.

The single-image repository is ghcr.io/beastyrabbit/paperless-llm. Update the
homelab deployment from its former separate frontend/backend containers before
using the new image. Repository changes alone do not change the live deployment.

Run the mocked release checks with Node 22/24:

    node --experimental-strip-types --test scripts/release/*.test.mts
