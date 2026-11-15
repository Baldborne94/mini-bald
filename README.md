# MiniBald

Personal, self-hosted web app to catalogue and paint miniatures. One Docker container, one data folder, no cloud.

**Status: Phase 1** — catalogue (groups, miniatures, tags, status), photos with timeline, search and filters, themes, basic dashboard.
Next: recipes, paint inventory and sessions (Phase 2), AI assistant (Phase 3), streaks, badges and challenges (Phase 4), PIN, HTTPS/PWA install and backups (Phase 5).

## Run with Docker

```bash
cp .env.example .env      # set PUID/PGID to your user (run `id`), adjust TZ and PORT
mkdir -p data
docker compose up -d --build
```

Open `http://<host>:8080`. From a phone on the same network, use the PC/NAS IP address.

### The data folder

Everything the app stores is in the folder mounted at `/data` (`./data` by default):

```
data/
├─ minis.db                       SQLite database (stores photo paths, never the images)
├─ photos/<group>/<miniature>-<id>/2026-11-15_143022_in_progress.jpg
├─ backups/                       database copy taken before each schema migration
├─ trash/                         photos of deleted miniatures (nothing is hard-deleted)
└─ cache/thumbs/                  generated thumbnails, safe to delete
```

Renaming a miniature or group, or moving a miniature to another group, renames the folders on disk too.
Photos of miniatures without a group live in `photos/_ungrouped/`.

**Migrating to another machine:** `docker compose down`, copy the whole `data` folder, start the container there.
Stop the container first so SQLite flushes its write-ahead log into `minis.db`.

## Development

Requires Node 22+.

```bash
npm install
npm run dev          # API on :8080, Vite on :5173 (proxies /api)
npm test             # API tests against a temporary data folder
npm run typecheck
npm run build        # client/dist + server/dist/index.js
```

### Layout

- `shared/` — zod schemas and types used by both sides
- `server/` — Fastify REST API, better-sqlite3, sharp; `migrations/NNN_name.sql` are applied in order at startup
- `client/` — React + Vite PWA; themes are CSS custom-property blocks in `src/styles/themes.css`

### Adding a migration

Create `server/migrations/002_whatever.sql`. On the next start it runs once inside a transaction and is recorded in
`schema_migrations`; the previous database is copied to `data/backups/` first. Migrations are forward-only.

## Notes

- Service workers need HTTPS (or `localhost`), so over plain `http://<ip>` the app works fully but cannot be installed
  as a PWA yet. Planned for Phase 5.
- There is no authentication yet: only expose it on a network you trust.
