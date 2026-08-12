#!/bin/sh
set -eu

ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
LAB_CYCLE="/Users/mk/MEMO/Kimi Base/sars-scripts/bin/testing-lab-test-cycle.sh"

if [ -x "$LAB_CYCLE" ]; then
  exec "$LAB_CYCLE" \
    --project "$ROOT" \
    --build "npm run check" \
    --test "npm run test:product && npm run test:studio-ui && npm run test:guided-flow && npm run test:frame-picker && npm run test:multires && npm run test:distribution && npm run test:release-browser"
fi

cd "$ROOT"
npm run test:all
