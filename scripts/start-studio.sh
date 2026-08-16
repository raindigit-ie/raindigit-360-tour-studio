#!/bin/sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
URL="http://127.0.0.1:8767/?edit=1"
cd "$ROOT"

if ! command -v docker >/dev/null 2>&1; then
  printf '%s\n' "Docker Desktop is required. Install it, open it once, then run this launcher again." >&2
  exit 1
fi

if ! docker info >/dev/null 2>&1; then
  if command -v open >/dev/null 2>&1; then
    open -a Docker >/dev/null 2>&1 || true
  fi
  printf '%s\n' "Waiting for Docker Desktop..."
  attempts=0
  while ! docker info >/dev/null 2>&1; do
    attempts=$((attempts + 1))
    if [ "$attempts" -ge 90 ]; then
      printf '%s\n' "Docker Desktop did not become ready. Open Docker Desktop and try again." >&2
      exit 1
    fi
    sleep 2
  done
fi

mkdir -p studio-workspace dist release
if [ "${RAINDIGIT_REBUILD:-0}" = "1" ] || [ -z "$(docker compose images -q studio 2>/dev/null)" ]; then
  printf '%s\n' "Preparing the RainDigit Studio runtime (first start or requested rebuild)..."
  docker compose up -d --build studio
else
  printf '%s\n' "Starting the existing RainDigit Studio runtime..."
  docker compose up -d studio
fi

attempts=0
while ! curl --fail --silent "http://127.0.0.1:8767/__tour-editor/status" >/dev/null 2>&1; do
  attempts=$((attempts + 1))
  if [ "$attempts" -ge 60 ]; then
    docker compose logs --tail=80 studio >&2
    printf '%s\n' "The studio did not start. The recent service log is shown above." >&2
    exit 1
  fi
  sleep 1
done

printf '%s\n' "RainDigit 360 Tour Studio is ready: $URL"
if [ "${RAINDIGIT_NO_OPEN:-0}" = "1" ]; then
  exit 0
elif command -v open >/dev/null 2>&1; then
  open "$URL"
elif command -v xdg-open >/dev/null 2>&1; then
  xdg-open "$URL" >/dev/null 2>&1 || true
fi
