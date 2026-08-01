#!/bin/sh
set -eu

repo_root="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
cd "$repo_root"

compose_config() {
  env \
    APP_VERSION=smoke \
    PAPERLESS_URL=https://paperless-smoke.invalid \
    PAPERLESS_TOKEN=paperless-smoke-token \
    MISTRAL_API_KEY=mistral-smoke-key \
    OLLAMA_URL=http://ollama-smoke.invalid:11434 \
    QDRANT_URL=http://qdrant-smoke.invalid:6333 \
    PAPERLESS_LLM_API_TOKEN=backend-smoke-token \
    docker compose --env-file /dev/null config "$@"
}

compose_config --quiet

compose_config --format json | node -e '
let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  input += chunk;
});
process.stdin.on("end", () => {
  const config = JSON.parse(input);
  const frontendEnv = config.services?.frontend?.environment ?? {};
  if (!Object.prototype.hasOwnProperty.call(frontendEnv, "PAPERLESS_LLM_API_TOKEN")) {
    throw new Error("frontend service must receive PAPERLESS_LLM_API_TOKEN for server-side proxy auth");
  }
  for (const key of Object.keys(frontendEnv)) {
    if (key.startsWith("NEXT_PUBLIC") && key.includes("TOKEN")) {
      throw new Error(`frontend service must not expose token as public env: ${key}`);
    }
  }
});
'

if [ "${PAPERLESS_LLM_DEPLOYMENT_SMOKE_BUILD:-false}" = "true" ]; then
  image_name="${PAPERLESS_LLM_BACKEND_SMOKE_IMAGE:-paperless-local-llm-backend:smoke}"
  docker build \
    --file apps/backend/Dockerfile \
    --target runner \
    --build-arg "CODEX_CLI_VERSION=${CODEX_CLI_VERSION:-0.145.0}" \
    --tag "$image_name" \
    .

  smoke_env="-e NODE_ENV=development -e PAPERLESS_LLM_REQUIRE_SECRETS=false"
  docker run --rm $smoke_env "$image_name" check-capabilities
  docker run --rm $smoke_env "$image_name" smoke-ocr-runtime

  docker run --rm $smoke_env "$image_name" sh -c 'test -d /app/data/backend-writer.lock && test -f /app/data/backend-writer.lock/pid && test -f /app/data/backend-writer.lock/created_at'

  lock_volume="${PAPERLESS_LLM_LOCK_SMOKE_VOLUME:-paperless-local-llm-lock-smoke}"
  docker volume rm "$lock_volume" >/dev/null 2>&1 || true
  docker volume create "$lock_volume" >/dev/null
  cleanup_lock_volume() {
    docker volume rm "$lock_volume" >/dev/null 2>&1 || true
  }
  trap cleanup_lock_volume EXIT

  docker run --rm -v "${lock_volume}:/app/data" $smoke_env "$image_name" sh -c 'test -d /app/data/backend-writer.lock'
  docker run --rm -v "${lock_volume}:/data" alpine:3.22 sh -c 'test ! -e /data/backend-writer.lock'

  docker run --rm -v "${lock_volume}:/data" alpine:3.22 sh -c 'mkdir /data/backend-writer.lock && printf stale >/data/backend-writer.lock/pid && printf stale >/data/backend-writer.lock/created_at'
  if docker run --rm -v "${lock_volume}:/app/data" $smoke_env "$image_name" sh -c 'true'; then
    printf '%s\n' "Expected stale backend writer lock to fail closed." >&2
    exit 1
  fi
  docker run --rm -v "${lock_volume}:/data" alpine:3.22 sh -c 'rm -f /data/backend-writer.lock/pid /data/backend-writer.lock/created_at && rmdir /data/backend-writer.lock'

  docker run --rm -v "${lock_volume}:/data" alpine:3.22 sh -c 'mkdir /data/backend-writer.lock'
  if docker run --rm -v "${lock_volume}:/app/data" $smoke_env "$image_name" sh -c 'true'; then
    printf '%s\n' "Expected contended backend writer lock to fail closed." >&2
    exit 1
  fi
  docker run --rm -v "${lock_volume}:/data" alpine:3.22 sh -c 'rmdir /data/backend-writer.lock'

  if docker run --rm $smoke_env -e PAPERLESS_LLM_BACKEND_WRITER_LOCK_DIR=/app/data "$image_name" sh -c 'true'; then
    printf '%s\n' "Expected invalid backend writer lock path to fail." >&2
    exit 1
  fi
  if docker run --rm $smoke_env -e PAPERLESS_LLM_BACKEND_WRITER_LOCK_DIR=/app/data/../bad.lock "$image_name" sh -c 'true'; then
    printf '%s\n' "Expected parent traversal backend writer lock path to fail." >&2
    exit 1
  fi
  docker run --rm -v "${lock_volume}:/data" alpine:3.22 sh -c 'ln -s /tmp /data/symlink.lock'
  if docker run --rm -v "${lock_volume}:/app/data" $smoke_env -e PAPERLESS_LLM_BACKEND_WRITER_LOCK_DIR=/app/data/symlink.lock "$image_name" sh -c 'true'; then
    printf '%s\n' "Expected symlink backend writer lock path to fail." >&2
    exit 1
  fi
  docker run --rm -v "${lock_volume}:/data" alpine:3.22 sh -c 'rm -f /data/symlink.lock'

  if docker run --rm -e NODE_ENV=production -e PAPERLESS_LLM_REQUIRE_SECRETS=true "$image_name" check-capabilities; then
    printf '%s\n' "Expected production missing core secrets to fail." >&2
    exit 1
  fi
  if docker run --rm -e NODE_ENV=production -e PAPERLESS_LLM_REQUIRE_SECRETS=true -e PAPERLESS_TOKEN=paperless-smoke-token "$image_name" check-capabilities; then
    printf '%s\n' "Expected production missing backend auth token to fail." >&2
    exit 1
  fi
  docker run --rm \
    -e NODE_ENV=production \
    -e PAPERLESS_LLM_REQUIRE_SECRETS=true \
    -e PAPERLESS_TOKEN=paperless-smoke-token \
    -e PAPERLESS_LLM_API_TOKEN=backend-smoke-token \
    "$image_name" \
    check-capabilities
  if docker run --rm $smoke_env -e PAPERLESS_LLM_MISTRAL_ENABLED=true "$image_name" check-capabilities; then
    printf '%s\n' "Expected enabled Mistral without MISTRAL_API_KEY to fail." >&2
    exit 1
  fi
  if docker run --rm $smoke_env -e PAPERLESS_LLM_CODEX_ENABLED=true "$image_name" check-capabilities; then
    printf '%s\n' "Expected enabled Codex without auth.json to fail." >&2
    exit 1
  fi
fi

printf '%s\n' "Deployment smoke checks passed."
