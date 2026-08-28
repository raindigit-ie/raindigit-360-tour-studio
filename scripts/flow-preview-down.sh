#!/bin/sh
set -eu

: "${FLOW_PREVIEW_STATE_DIR:?FLOW_PREVIEW_STATE_DIR is required}"

container_file="${FLOW_PREVIEW_STATE_DIR}/container"
if [ -f "$container_file" ]; then
  preview_container="$(sed -n '1p' "$container_file")"
  case "$preview_container" in
    raindigit-studio-preview-*) docker rm --force "$preview_container" >/dev/null 2>&1 || true ;;
    *) printf 'Refusing unexpected preview container name: %s\n' "$preview_container" >&2; exit 1 ;;
  esac
fi
