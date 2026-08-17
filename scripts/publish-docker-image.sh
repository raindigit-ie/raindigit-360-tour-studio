#!/bin/sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$ROOT"

IMAGE_REPOSITORY=${RAINDIGIT_DOCKER_REPOSITORY:-stekolshchykov/raindigit-360-tour-studio}
VERSION=${RAINDIGIT_DOCKER_VERSION:-$(node -p "require('./package.json').version")}
REVISION=$(git rev-parse --short=12 HEAD)
BUILD_DATE=$(date -u +%Y-%m-%dT%H:%M:%SZ)

if ! docker info >/dev/null 2>&1; then
  printf '%s\n' "Docker is not available." >&2
  exit 1
fi

if ! git diff --quiet || ! git diff --cached --quiet; then
  printf '%s\n' "Commit the reviewed Docker source before publishing an immutable image." >&2
  exit 1
fi

docker buildx build \
  --target studio \
  --platform linux/amd64,linux/arm64 \
  --build-arg "BUILD_DATE=$BUILD_DATE" \
  --build-arg "VCS_REF=$REVISION" \
  --build-arg "VERSION=$VERSION" \
  --tag "$IMAGE_REPOSITORY:$VERSION" \
  --tag "$IMAGE_REPOSITORY:sha-$REVISION" \
  --tag "$IMAGE_REPOSITORY:latest" \
  --provenance=mode=max \
  --sbom=true \
  --push \
  .

docker buildx imagetools inspect "$IMAGE_REPOSITORY:$VERSION"
printf '%s\n' "Published $IMAGE_REPOSITORY:$VERSION, $IMAGE_REPOSITORY:sha-$REVISION and $IMAGE_REPOSITORY:latest"
