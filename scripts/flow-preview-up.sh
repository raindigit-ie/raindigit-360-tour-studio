#!/bin/sh
set -eu

: "${FLOW_PREVIEW_ID:?FLOW_PREVIEW_ID is required}"
: "${FLOW_PREVIEW_STATE_DIR:?FLOW_PREVIEW_STATE_DIR is required}"

preview_port="${RAINDIGIT_STUDIO_PREVIEW_PORT:-18767}"
preview_image="${RAINDIGIT_STUDIO_PREVIEW_IMAGE:-raindigit-360-tour-studio:local}"
preview_container="raindigit-studio-preview-${FLOW_PREVIEW_ID}"
preview_data="${FLOW_PREVIEW_STATE_DIR}/data"

mkdir -p "$preview_data"
docker run --detach \
  --name "$preview_container" \
  --publish "127.0.0.1:${preview_port}:8767" \
  --mount "type=bind,source=${preview_data},target=/data" \
  "$preview_image" >/dev/null
printf '%s\n' "$preview_container" > "${FLOW_PREVIEW_STATE_DIR}/container"

attempt=0
until curl --fail --silent --show-error "http://127.0.0.1:${preview_port}/__tour-editor/status" >/dev/null; do
  attempt=$((attempt + 1))
  if [ "$attempt" -ge 80 ]; then
    docker logs "$preview_container" >&2 || true
    exit 1
  fi
  sleep 0.1
done

printf 'preview_container=%s\npreview_port=%s\n' "$preview_container" "$preview_port"
