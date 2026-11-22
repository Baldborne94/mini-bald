# Testing

```
npm run test:all     # everything, in this order:
npm run typecheck    #   types of server, client, tests
npm test             #   unit and API tests (no browser), ~30 s
npm run build        #   client and server bundles
npm run test:e2e     #   browser tests against the built app, ~2-3 min
```

On Windows, run the same commands in a terminal inside the project folder. The browser tests need Chromium once:
`npx playwright install chromium`. After a run, `npx playwright show-report` opens a report with screenshots and a
step-by-step trace of any failure.

GitHub runs all of it on every pull request and every push to `main`, plus a Docker check that builds the real
image, starts it as a normal user on a mounted data folder, and confirms the data survives a restart
(`.github/workflows/ci.yml`).

## What the automated tests cover

**API and server** (`server/test`)
- Migrations: fresh database, upgrade with a backup copy taken first, failed migration rolled back, stray files ignored.
- Groups: create, one level of nesting only, rename moves photo folders, delete keeps miniatures.
- Miniatures: create, edit, tags (case-insensitive), filters, search, sort, random pick, status history and dates,
  delete moves photos to trash.
- Photos: upload, non-images refused, thumbnails, caption/date/stage edits, cover rules, delete to trash.
- Paints and shopping list: stock changes keep the list in step, buying restocks, duplicates refused,
  bulk add, CSV export, catalogue files (sizes, uniqueness, Speedpaint codes), filling missing colours.
- Recipes: ticks survive edits and reordering, clean copies, library, unknown paints refused.
- Sessions: one timer at a time, manual logs, duration corrections, totals.
- AI assistant: exact request sent to the Anthropic API (image, JSON schema, fallback, web search,
  pause/resume, refusals, errors) against a local stand-in; validation and saving with the mock provider;
  behaviour without a key.
- Motivation: streaks, badges unlocked once, challenges measured from real data, statistics, insights,
  activity calendar, year recap.
- PIN lock, backups (database, zip, daily snapshots with pruning), exports, security headers, input validation.

**Client logic** (`client/test`): CSV import parser, duration/clock/plural/date formatting.

**In the browser** (`e2e/specs`, desktop 1366×860 and a Pixel 7 phone)
- Every page loads, fits the screen without sideways scrolling, and every button and link has a readable name.
- Navigation on desktop and through "More" on the phone.
- Groups and sub-groups; adding, editing, searching, filtering and deleting miniatures; status changes with
  the finished celebration.
- Photos from the gallery and from the camera input, viewer with caption/cover/delete, before/after compare,
  refused uploads.
- Paints: add one by one, stock cycling, duplicates, catalogue shelves and code search, wishlist,
  CSV import, catalogue autofill, missing colours, never-used filter; shopping list.
- Recipes: editor with linked paints, ticking, reordering, missing paints to shopping list, copy, library,
  bench mode.
- Painting timer across pages, manual logs, notes, duration fixes, one timer at a time.
- AI assistant with the mock provider: recipe saved, feedback needing a photo, tutorial links.
- Goals: streak, challenges (complete, set aside, delete), badges, the daily draw, statistics, calendar,
  year in paint, dashboard extras.
- Settings: themes remembered, every download, install details.
- PIN lock: set, mismatch, other devices locked out (API, photos, backups), wrong/right PIN, change, remove.
- Any console error or uncaught exception on any page fails the test that caused it.

## What still needs a person

| Check | How |
|---|---|
| AI assistant with the real API | Put `ANTHROPIC_API_KEY` in `.env`, ask for a recipe, feedback and tutorials. |
| Camera on a real phone | Open the app on the phone, "Take photo" on a miniature. |
| HTTPS and installing the app | Follow `docs/deploy.md` (mkcert), then Settings → Install. |
| Bench mode keeping the screen on | Needs HTTPS on a real phone. |
| The move to the NAS | Follow `docs/deploy.md`. |
