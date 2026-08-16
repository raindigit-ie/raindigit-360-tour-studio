FROM node:22.12-alpine AS studio

RUN apk add --no-cache \
    imagemagick \
    ffmpeg \
    unzip \
    zip

WORKDIR /workspace
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund
COPY scripts ./scripts
COPY web-tour ./web-tour
RUN mkdir -p web-tour/panoramas web-tour/thumbnails

EXPOSE 8767
CMD ["node", "scripts/tour-editor-server.mjs", "--port", "8767"]

FROM nginx:1.27-alpine AS release

COPY docker/release-nginx.conf /etc/nginx/conf.d/default.conf
COPY release/ /usr/share/nginx/html/

EXPOSE 8080
