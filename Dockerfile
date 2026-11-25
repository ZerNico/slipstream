# syntax=docker/dockerfile:1

# Slipstream in one image: the server, the built web app and a pinned ffmpeg 9. Releases are
# published as ghcr.io/zernico/slipstream (.github/workflows/docker.yml).
#   docker build -t slipstream .
#   docker run -p 8080:8080 -v slipstream-config:/config -v slipstream-data:/data slipstream
# Bootstrap settings are SLIPSTREAM_* environment variables (docs/configuration.md); the
# rest is configured in the web UI. Back up /config: it holds the database and secret.key,
# without which stored source credentials cannot be read.

# Bases pinned by digest (multi-arch index), so a rebuild never picks up a different Node or
# ffmpeg. Bumping ffmpeg is a deliberate release, guarded by the server's startup self-check.
FROM node:26-slim@sha256:e6bedef217677b276c591795e169840edd9096dbf13f29df8ef8d1856b8820bc AS node
FROM mwader/static-ffmpeg:9.0.2@sha256:7d9bdaaf887f7e6ce6151f67325c344074b5ff1fb75316011c3376503e449a7b AS ffmpeg

FROM node AS build
WORKDIR /repo
# pnpm from packageManager, so package.json stays the one place its version is pinned. Node 25+
# no longer ships corepack.
COPY package.json ./
RUN npm install --global "$(node -p 'require("./package.json").packageManager')"
COPY . .
# Only what the web build and the server need: the app (Expo, React Native) stays out.
RUN --mount=type=cache,id=slipstream-pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile --store-dir /pnpm/store \
      --filter "@slipstream/web..." --filter "@slipstream/server..."
RUN pnpm --filter @slipstream/web build
# Prune to production dependencies of the server and the fake source (the `demo` profile).
# The workspace layout stays: Node runs the packages' .ts sources directly, which it only does
# outside node_modules.
RUN --mount=type=cache,id=slipstream-pnpm-store,target=/pnpm/store \
    rm -rf node_modules apps/*/node_modules packages/*/node_modules tools/*/node_modules \
 && pnpm install --frozen-lockfile --offline --prod --store-dir /pnpm/store \
      --filter "@slipstream/server..." --filter "@slipstream/fake-source..."
# The version the server reports: a release tag's (`0.1.0`), or for other builds the checked-in
# one with a label and the commit (`0.1.0-edge+1a2b3c4`). docker.yml passes both; a plain
# `docker build` keeps the checked-in version. Last, so a new commit reuses every layer above.
ARG APP_VERSION=
ARG APP_REVISION=
RUN node scripts/stamp-version.ts "$APP_VERSION" "$APP_REVISION"

FROM node AS runtime
# tini reaps ffmpeg processes and forwards signals; DejaVu is the fake source's overlay font.
RUN apt-get update \
 && apt-get install -y --no-install-recommends tini fonts-dejavu-core \
 && rm -rf /var/lib/apt/lists/*
COPY --from=ffmpeg /ffmpeg /ffprobe /usr/local/bin/
WORKDIR /app
COPY --from=build /repo/package.json /repo/pnpm-workspace.yaml ./
COPY --from=build /repo/node_modules node_modules
COPY --from=build /repo/packages packages
COPY --from=build /repo/tools tools
COPY --from=build /repo/apps/server apps/server
COPY --from=build /repo/apps/web/dist apps/web/dist
RUN mkdir -p /config /data && chown node:node /config /data
ENV NODE_ENV=production \
    SLIPSTREAM_HOST=0.0.0.0 \
    SLIPSTREAM_PORT=8080 \
    SLIPSTREAM_CONFIG_DIR=/config \
    SLIPSTREAM_DATA_DIR=/data \
    SLIPSTREAM_WEB_DIR=/app/apps/web/dist \
    SLIPSTREAM_FFMPEG=/usr/local/bin/ffmpeg \
    SLIPSTREAM_FFPROBE=/usr/local/bin/ffprobe \
    SLIPSTREAM_MDNS=false
USER node
VOLUME ["/config", "/data"]
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD ["node", "-e", "fetch(`http://127.0.0.1:${process.env.SLIPSTREAM_PORT}/api/health`).then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
ENTRYPOINT ["tini", "--"]
CMD ["node", "apps/server/src/main.ts"]
