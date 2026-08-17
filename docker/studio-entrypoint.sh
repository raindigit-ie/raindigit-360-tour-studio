#!/bin/sh
set -eu

for directory in \
  "${INSTA360_TOUR_WORKSPACE}" \
  "${INSTA360_TOUR_ARTIFACTS}" \
  "${INSTA360_TOUR_RELEASE}" \
  "${INSTA360_TOUR_MULTIRES_RELEASE}" \
  "${INSTA360_TOUR_BUILD_CACHE}" \
  "${INSTA360_TOUR_ARCHIVES}"
do
  mkdir -p "$directory"
  if [ ! -w "$directory" ]; then
    printf 'RainDigit Studio cannot write to %s. Use a Docker named volume mounted at /data.\n' "$directory" >&2
    exit 1
  fi
done

exec "$@"
