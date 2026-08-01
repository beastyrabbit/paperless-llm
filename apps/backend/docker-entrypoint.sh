#!/bin/sh
set -eu

log() {
  printf '%s\n' "$*" >&2
}

fatal() {
  log "ERROR: $*"
  exit 1
}

is_true() {
  case "${1:-}" in
    1 | true | TRUE | yes | YES | on | ON) return 0 ;;
    *) return 1 ;;
  esac
}

is_false() {
  case "${1:-}" in
    0 | false | FALSE | no | NO | off | OFF) return 0 ;;
    *) return 1 ;;
  esac
}

require_binary() {
  command -v "$1" >/dev/null 2>&1 || fatal "Required runtime binary is missing: $1"
}

cleanup_lock() {
  :
}

ensure_private_dir() {
  dir="$1"
  mkdir -p "$dir" || fatal "Could not create runtime directory: $dir"
  [ -d "$dir" ] || fatal "Runtime path is not a directory: $dir"
  [ -w "$dir" ] || fatal "Runtime directory is not writable by the backend user: $dir"
  chmod 0700 "$dir" 2>/dev/null || true
}

is_missing_secret() {
  value="${1:-}"
  case "$value" in
    "" | your-* | replace-with-*) return 0 ;;
    *) return 1 ;;
  esac
}

requires_core_secrets() {
  is_true "${PAPERLESS_LLM_REQUIRE_SECRETS:-false}" || [ "${NODE_ENV:-}" = "production" ]
}

run_secret_checks() {
  if requires_core_secrets; then
    is_missing_secret "${PAPERLESS_TOKEN:-}" &&
      fatal "Paperless auth is required but PAPERLESS_TOKEN is not set."
    is_missing_secret "${PAPERLESS_LLM_API_TOKEN:-${LOCAL_LLM_API_KEY:-}}" &&
      fatal "Backend auth is required but PAPERLESS_LLM_API_TOKEN is not set."
  fi

  if is_true "${PAPERLESS_LLM_MISTRAL_AUTH_REQUIRED:-false}" || is_true "${PAPERLESS_LLM_MISTRAL_ENABLED:-false}"; then
    is_missing_secret "${MISTRAL_API_KEY:-}" &&
      fatal "Mistral auth is required but MISTRAL_API_KEY is not set."
  fi

  if is_true "${PAPERLESS_LLM_CODEX_AUTH_REQUIRED:-false}" || is_true "${PAPERLESS_LLM_CODEX_ENABLED:-false}"; then
    [ -s "${CODEX_HOME}/auth.json" ] ||
      fatal "Codex auth is required but no non-empty auth.json is mounted in CODEX_HOME."
  fi
}

run_capability_checks() {
  if is_false "${PAPERLESS_LLM_CONTAINER_CHECKS_ENABLED:-true}"; then
    return 0
  fi

  require_binary node
  require_binary ocrmypdf
  require_binary tesseract
  require_binary codex

  node --version >/dev/null
  ocrmypdf --version >/dev/null
  tesseract --version >/dev/null
  codex --version >/dev/null

  if [ ! -s "${CODEX_HOME}/auth.json" ]; then
    log "Codex auth is not present; Codex-dependent requests will fail until auth.json is mounted in CODEX_HOME."
  else
    chmod 0600 "${CODEX_HOME}/auth.json" 2>/dev/null || true
  fi
}

validate_writer_lock_dir() {
  candidate="${PAPERLESS_LLM_BACKEND_WRITER_LOCK_DIR:-/app/data/backend-writer.lock}"
  data_root="/app/data"

  [ "$candidate" != "/" ] || fatal "Backend writer lock path must not be root."
  [ "$candidate" != "$data_root" ] || fatal "Backend writer lock path must be a child of /app/data."

  case "$candidate" in
    "$data_root"/*) ;;
    *) fatal "Backend writer lock path must be a direct child of /app/data." ;;
  esac

  lock_name="${candidate#"$data_root"/}"
  case "$lock_name" in
    "" | "." | ".." | */* | *"/"* | *".."*) fatal "Backend writer lock path must be a direct child name under /app/data." ;;
  esac

  [ -d "$data_root" ] || fatal "Backend data root is missing: /app/data"
  [ ! -L "$data_root" ] || fatal "Backend data root must not be a symlink: /app/data"
  if [ -L "$candidate" ]; then
    fatal "Backend writer lock path must not be a symlink: $candidate"
  fi
  if [ -e "$candidate" ] && [ ! -d "$candidate" ]; then
    fatal "Backend writer lock path exists but is not a directory: $candidate"
  fi

  printf '%s\n' "$candidate"
}

acquire_writer_lock() {
  if is_false "${PAPERLESS_LLM_BACKEND_WRITER_LOCK_ENABLED:-true}"; then
    return 0
  fi

  lock_dir="$(validate_writer_lock_dir)"

  if mkdir "$lock_dir" 2>/dev/null; then
    printf '%s\n' "$$" >"${lock_dir}/pid"
    printf '%s\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" >"${lock_dir}/created_at"
  else
    fatal "Another backend writer lock exists at ${lock_dir}. Stop the other backend before starting this container."
  fi

  cleanup_lock() {
    if [ -n "${lock_dir:-}" ] && [ -d "$lock_dir" ]; then
      rm -f "${lock_dir}/pid" "${lock_dir}/created_at"
      rmdir "$lock_dir"
    fi
  }
}

smoke_ocr_runtime() {
  require_binary python3
  require_binary ocrmypdf
  require_binary qpdf

  tmp_dir="$(mktemp -d "${TMPDIR}/ocr-smoke.XXXXXX")"
  input_pdf="${tmp_dir}/input.pdf"
  output_pdf="${tmp_dir}/output.pdf"

  python3 - "$input_pdf" <<'PY'
import sys

objects = [
    b"<< /Type /Catalog /Pages 2 0 R >>",
    b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 144] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    b"<< /Length 45 >>\nstream\nBT /F1 18 Tf 36 72 Td (OCR SMOKE TEST) Tj ET\nendstream",
]

pdf = bytearray(b"%PDF-1.4\n%\xE2\xE3\xCF\xD3\n")
offsets = [0]
for index, obj in enumerate(objects, start=1):
    offsets.append(len(pdf))
    pdf.extend(f"{index} 0 obj\n".encode("ascii"))
    pdf.extend(obj)
    pdf.extend(b"\nendobj\n")

xref = len(pdf)
pdf.extend(f"xref\n0 {len(objects) + 1}\n".encode("ascii"))
pdf.extend(b"0000000000 65535 f \n")
for offset in offsets[1:]:
    pdf.extend(f"{offset:010d} 00000 n \n".encode("ascii"))
pdf.extend(
    f"trailer\n<< /Size {len(objects) + 1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n".encode(
        "ascii"
    )
)

with open(sys.argv[1], "wb") as fh:
    fh.write(pdf)
PY

  ocrmypdf --skip-text --deskew --rotate-pages "$input_pdf" "$output_pdf" >/dev/null
  qpdf --check "$output_pdf" >/dev/null

  rm -f "$input_pdf" "$output_pdf"
  rmdir "$tmp_dir"
}

prepare_runtime() {
  : "${CODEX_HOME:=/app/codex-home}"
  : "${TMPDIR:=/app/data/tmp}"
  : "${PAPERLESS_LLM_TINYBASE_DATA_DIR:=/app/data/tinybase}"
  : "${PAPERLESS_LLM_OPERATIONAL_LEDGER_DATA_DIR:=/app/data/operational-ledger}"

  export CODEX_HOME TMPDIR PAPERLESS_LLM_TINYBASE_DATA_DIR PAPERLESS_LLM_OPERATIONAL_LEDGER_DATA_DIR

  ensure_private_dir /app/data
  ensure_private_dir "$CODEX_HOME"
  ensure_private_dir "$TMPDIR"
  ensure_private_dir "$PAPERLESS_LLM_TINYBASE_DATA_DIR"
  ensure_private_dir "$PAPERLESS_LLM_OPERATIONAL_LEDGER_DATA_DIR"
}

prepare_runtime
run_secret_checks
run_capability_checks

case "${1:-}" in
  check-capabilities)
    exit 0
    ;;
  smoke-ocr-runtime)
    smoke_ocr_runtime
    exit 0
    ;;
esac

acquire_writer_lock

"$@" &
child_pid="$!"

forward_and_wait() {
  signal="$1"
  kill "-${signal}" "$child_pid" 2>/dev/null || true
  set +e
  wait "$child_pid" 2>/dev/null
  status="$?"
  set -e
  cleanup_lock
  exit "$status"
}

trap 'forward_and_wait TERM' TERM
trap 'forward_and_wait INT' INT

set +e
wait "$child_pid"
status="$?"
set -e
cleanup_lock
exit "$status"
