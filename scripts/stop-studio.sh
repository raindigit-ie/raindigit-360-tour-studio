#!/bin/sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$ROOT"
docker compose stop studio
printf '%s\n' "RainDigit 360 Tour Studio stopped. Project files remain on this computer."

