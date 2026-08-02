FROM node:22-bookworm-slim AS studio

RUN apt-get update \
  && apt-get install -y --no-install-recommends imagemagick librsvg2-bin unzip zip \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /workspace
COPY package.json ./
COPY scripts ./scripts
COPY web-tour ./web-tour

EXPOSE 8767
CMD ["node", "scripts/tour-editor-server.mjs", "--port", "8767"]

FROM nginx:1.27-alpine AS release

COPY docker/release-nginx.conf /etc/nginx/conf.d/default.conf
COPY release/ /usr/share/nginx/html/

EXPOSE 8080
