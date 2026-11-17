# ---- Build: compile the client and bundle the server ----
FROM node:22-bookworm-slim AS build
# Compiler toolchain: only used if better-sqlite3 has no prebuilt binary for this CPU (some NAS models).
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY server/package.json server/
COPY client/package.json client/
RUN npm ci
COPY . .
# Build, then drop dev dependencies so the runtime stage can reuse this node_modules as-is.
# The client's packages are all dev dependencies (Vite bundles them), so they go too.
RUN npm run build && npm prune --omit=dev \
 # Native-module leftovers this Debian image never loads: Alpine and WebAssembly builds of sharp, SQLite sources.
 && rm -rf node_modules/@img/*musl* node_modules/@img/sharp-wasm32 node_modules/better-sqlite3/deps node_modules/better-sqlite3/src

# ---- Runtime: production dependencies + built output only ----
# Same base image as the build stage: native modules (better-sqlite3, sharp) must match it.
FROM node:22-bookworm-slim
ENV NODE_ENV=production \
    PORT=8080 \
    DATA_DIR=/data \
    MIGRATIONS_DIR=/app/server/migrations \
    CATALOG_DIR=/app/server/catalog \
    CLIENT_DIST=/app/client/dist
WORKDIR /app
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules node_modules
COPY server/migrations server/migrations
COPY server/catalog server/catalog
COPY server/healthcheck.mjs server/healthcheck.mjs
COPY --from=build /app/server/dist server/dist
COPY --from=build /app/client/dist client/dist
# World-writable so the container can run as any PUID:PGID when no volume is mounted.
RUN mkdir -p /data && chmod 777 /data
VOLUME /data
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s CMD ["node", "server/healthcheck.mjs"]
CMD ["node", "server/dist/index.js"]
