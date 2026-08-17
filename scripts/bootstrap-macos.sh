#!/bin/sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)

if [ "$(uname -s)" != "Darwin" ]; then
  printf '%s\n' "This launcher is for macOS. On Linux, run: npm run app:start" >&2
  exit 1
fi

ARCH=$(uname -m)
case "$ARCH" in
  arm64)
    printf '%s\n' "Apple Silicon detected. Building the native ARM64 Studio runtime locally..."
    ;;
  x86_64)
    printf '%s\n' "Intel Mac detected. Building the native AMD64 Studio runtime locally..."
    ;;
  *)
    printf '%s\n' "Unsupported Mac architecture: $ARCH" >&2
    exit 1
    ;;
esac

if ! command -v docker >/dev/null 2>&1 && [ -d "/Applications/Docker.app" ]; then
  export PATH="/Applications/Docker.app/Contents/Resources/bin:$PATH"
fi

if ! command -v docker >/dev/null 2>&1; then
  printf '%s\n' "Docker Desktop is not installed. Install the Apple Silicon version from https://www.docker.com/products/docker-desktop/ and run this file again." >&2
  if command -v open >/dev/null 2>&1; then
    open "https://www.docker.com/products/docker-desktop/" >/dev/null 2>&1 || true
  fi
  exit 1
fi

cd "$ROOT"
exec sh scripts/start-studio.sh
