# MiniBald

Personal, self-hosted web app to catalogue and paint miniatures. One Docker container, one data folder, no cloud.

**Status: Phase 3** — catalogue (groups, miniatures, tags, status), photos with timeline and before/after compare,
paint inventory (with a Citadel / Army Painter / AK catalogue and CSV import) and shopping list, step-by-step recipes
with a reusable library, painting timer with history, AI assistant, themes, dashboard.
Next: streaks, badges and challenges (Phase 4), PIN, HTTPS/PWA install and backups (Phase 5).

## Run with Docker

```bash
cp .env.example .env      # set PUID/PGID to your user (run `id`), adjust TZ and PORT
mkdir -p data
docker compose up -d --build
```

Open `http://<host>:8080`. From a phone on the same network, use the PC/NAS IP address.

On Windows use `copy .env.example .env` and `mkdir data`; `PUID`/`PGID` can stay at their defaults.

**Updating:** `git pull`, then `docker compose up -d --build`. New database migrations run on start, after a copy of
the database is saved to `data/backups/`.

### The data folder

Everything the app stores is in the folder mounted at `/data` (`./data` by default):

```
data/
├─ minis.db                       SQLite database (stores photo paths, never the images)
├─ photos/<group>/<miniature>-<id>/2026-11-15_143022_in_progress.jpg
├─ backups/                       database copy taken before each schema migration
├─ trash/                         photos of deleted miniatures (nothing is hard-deleted)
├─ catalogs/                      optional extra paint catalogue files (see server/catalog/README.md)
└─ cache/thumbs/                  generated thumbnails, safe to delete
```

Renaming a miniature or group, or moving a miniature to another group, renames the folders on disk too.
Photos of miniatures without a group live in `photos/_ungrouped/`.

**Migrating to another machine:** `docker compose down`, copy the whole `data` folder, start the container there.
Stop the container first so SQLite flushes its write-ahead log into `minis.db`.

## AI assistant (optional)

Each miniature page has an assistant with three tools: a painting recipe built around the paints you own (saved
as a normal recipe with one tap), feedback on a work-in-progress photo, and a web search for tutorials.

It is the only part of the app that talks to the internet. To switch it on, put an
[Anthropic API key](https://platform.claude.com/) in `.env` and restart:

```
ANTHROPIC_API_KEY=sk-ant-...
AI_MODEL=claude-opus-5-5
AI_LANGUAGE=English
```

- The key is read by the backend only and never reaches the browser. Without a key the assistant is hidden behind
  a notice and everything else works.
- `AI_MODEL` is any current Claude model id; `claude-sonnet-5-5` and `claude-haiku-5-5` cost less per request.
  `AI_EFFORT` (low … max) is optional. `AI_LANGUAGE` sets the language of the answers.
- What is sent: the miniature's name, group, tags, notes, your paint list (for recipes) and the photo you pick,
  re-encoded to at most 2000 px. Nothing is sent until you press the button.
- Recipes come back as JSON in a fixed schema and are validated by the backend before being stored. Tutorial links
  are taken from the search results returned by the API, not from the model's text.
- Tutorial search uses Anthropic's web search tool, which must be enabled for your organization in the Console and
  is billed per search.
- If the model declines a request for policy reasons, the API retries it on a fallback model in the same call
  (server-side fallback, enabled for the models that support it).
- Every request is stored in `ai_runs` with its token counts, so answers can be re-read and usage stays visible.
- `AI_PROVIDER=mock` returns canned answers for trying the interface without spending anything.

To use another vendor or a local model, implement the `AiProvider` interface in `server/src/ai/provider.ts` and
return it from `server/src/ai/index.ts`; prompts, validation, storage and UI do not change.

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
