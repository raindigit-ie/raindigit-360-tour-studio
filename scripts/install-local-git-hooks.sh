#!/bin/sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$ROOT"

if ! command -v git >/dev/null 2>&1; then
  printf '%s\n' "Git is required to install the local quality gate." >&2
  exit 1
fi

chmod +x .githooks/pre-push
git config core.hooksPath .githooks

configured=$(git config --get core.hooksPath || true)
if [ "$configured" != ".githooks" ]; then
  printf '%s\n' "Could not activate the repository hooks directory." >&2
  exit 1
fi

printf '%s\n' "RainDigit local pre-push quality gate installed."
