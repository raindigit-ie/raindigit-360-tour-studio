# syntax=docker/dockerfile:1.7

FROM node:22.12-alpine AS production-dependencies

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund \
    && npm cache clean --force

FROM nginx:1.27-alpine AS release

COPY docker/release-nginx.conf /etc/nginx/conf.d/default.conf
COPY release/ /usr/share/nginx/html/

EXPOSE 8080

FROM node:22.12-alpine AS studio

RUN apk add --no-cache \
      ca-certificates \
      ffmpeg \
      imagemagick \
      tini \
      unzip \
      zip

ENV NODE_ENV=production \
    TOUR_SERVER_HOST=0.0.0.0 \
    INSTA360_TOUR_DRAFT_PATH=/data/manual-hotspot-overrides.json \
    INSTA360_TOUR_WORKSPACE=/data/workspace \
    INSTA360_TOUR_ARTIFACTS=/data/artifacts \
    INSTA360_TOUR_RELEASE=/data/release \
    INSTA360_TOUR_MULTIRES_RELEASE=/data/release-multires \
    INSTA360_TOUR_BUILD_CACHE=/data/build-cache \
    INSTA360_TOUR_ARCHIVES=/data/archives \
    INSTA360_TOUR_BUILD_CACHE_MAX_GB=8 \
    UV_THREADPOOL_SIZE=12 \
    VIPS_CONCURRENCY=3

WORKDIR /app
COPY --chown=node:node --from=production-dependencies /app/node_modules ./node_modules
COPY --chown=node:node package.json package-lock.json ./
COPY --chown=node:node CHANGELOG.md ./CHANGELOG.md
COPY --chown=node:node config/release-contract.json ./config/release-contract.json
COPY --chown=node:node scripts/tour-editor-server.mjs scripts/build-tour-release.mjs scripts/build-multires-release.mjs scripts/prune-build-cache.mjs ./scripts/
COPY --chown=node:node scripts/lib ./scripts/lib
COPY --chown=node:node web-tour ./web-tour
COPY --chmod=755 docker/studio-entrypoint.sh /usr/local/bin/raindigit-studio-entrypoint

RUN mkdir -p \
      /data/workspace \
      /data/artifacts \
      /data/release \
      /data/release-multires \
      /data/build-cache \
      /data/archives \
      /app/web-tour/panoramas \
      /app/web-tour/thumbnails \
    && chown -R node:node /data

ARG BUILD_DATE="unknown"
ARG VCS_REF="unknown"
ARG VERSION="0.2.0"

ENV RAINDIGIT_TOUR_COMMIT="$VCS_REF"

LABEL org.opencontainers.image.title="RainDigit 360 Tour Studio" \
      org.opencontainers.image.description="Portable local studio for building self-hosted RainDigit 360 tours" \
      org.opencontainers.image.url="https://raindigit.ie/services/immersive-tours" \
      org.opencontainers.image.source="https://github.com/raindigit-ie/raindigit-360-tour-studio" \
      org.opencontainers.image.vendor="RainDigit" \
      org.opencontainers.image.version="$VERSION" \
      org.opencontainers.image.revision="$VCS_REF" \
      org.opencontainers.image.created="$BUILD_DATE"

USER node
VOLUME ["/data"]
EXPOSE 8767

HEALTHCHECK --interval=10s --timeout=3s --start-period=10s --retries=12 \
  CMD node -e "fetch('http://127.0.0.1:8767/__tour-editor/status').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"

ENTRYPOINT ["/sbin/tini", "--", "/usr/local/bin/raindigit-studio-entrypoint"]
CMD ["node", "scripts/tour-editor-server.mjs", "--port", "8767"]
