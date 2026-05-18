#!/usr/bin/env sh
set -eu

if ! command -v rg >/dev/null 2>&1; then
  echo "ripgrep is required for .ref artifact checks" >&2
  exit 1
fi

targets=""
for path in apps/backend/dist apps/web/.next; do
  if [ -d "$path" ]; then
    targets="$targets $path"
  fi
done

if [ -z "$targets" ]; then
  exit 0
fi

if rg --fixed-strings ".ref/" $targets; then
  echo "Build artifacts must not reference .ref/ paths" >&2
  exit 1
fi
