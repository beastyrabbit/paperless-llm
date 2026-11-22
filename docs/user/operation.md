# Operation

## Spend controls and recovery

OCR discovery uses `added >= ocr.notBefore`, independently of service tags.
Set the cutoff to the first date you intend to process. A known Paperless page
count is required; unknown page counts stop before any paid request.
The daily budget reserves each document's page count before calling Mistral.
Reservations include ambiguous calls, since the provider may have billed them.

The worker writes the full result to SQLite before editing Paperless. A pending
version label identifies incomplete write-back, and a done label follows content
read-back verification. In-place writes fall back to a byte-distinct PDF version
when root relabelling returns 400, 404, or 405.

A crash or timeout during paid OCR produces an uncertain job. The default never
retries it automatically. In Activity, confirm a possible second charge to retry.
`allowAutoRetryUncertain` is an explicit override of that default.

`reconcile` rebuilds completed sources from done markers without OCR. Pending
markers without a saved result remain uncertain. After a version-upload response
is lost, inspect the pending version in Paperless and reconcile before retrying;
the worker will not blindly create another derivative.

Keep the SQLite database on durable local storage. Back up the database with
SQLite's backup API or stop the service before copying the database and WAL files.
DB loss preserves OCR spend markers in Paperless but loses review, undo, and
ownership history. Non-empty metadata then receives human-edit protection.

## Review

Jev picks from bounded catalog shortlists. New entities are proposals, never
automatic creations. Approving or mapping one proposal resolves its waiting
documents. Rejected entity names remain deduplicated.

Dependency-aware staging holds every field if the document type is unresolved.
Once the type passes, independent passing fields can apply. Titles wait for
their template inputs. Document staging holds the entire proposal whenever any
field needs review. A second read before writes catches edits made since staging.

Review approvals use the staged original value as a precondition. If someone
changed it in Paperless after staging, the service keeps the staged item instead
of overwriting the newer value. Unrelated tags and custom fields are preserved.

## Consolidation

Scans compare normalized names, trigrams, and aliases. Every proposed member is
checked directly against the canonical entity. Approval records each reassignment
under one batch. Reference checks are conservative: an opaque matching reference
can keep the retired entity with a warning.

Undo reverses recorded fields only when their current values still match the
merge. If an entity was deleted, undo recreates it with native matching disabled;
Paperless can assign a new ID. The response lists exact per-change outcomes.
Externally modified fields are skipped.

## Deployment

Mount config.yaml read-only and `/app/data` persistently. Keep the app behind
your authenticated reverse proxy on a private network; the application does not
provide its own identity system. Forward the original host and X-Forwarded-Proto so browser Origin
checks match. The single-container deployment replaces the old separate web and
backend services, so update deployment manifests before rollout.

`APP_VERSION` and `APP_REVISION` are Docker build arguments. The container
health check uses `${PORT:-3765}` on `127.0.0.1`. If you change `server.port`,
set `PORT` and the container port mapping to match.
