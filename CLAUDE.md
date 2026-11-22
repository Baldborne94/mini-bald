# MiniBald: notes for Claude

A personal, self-hosted app to catalogue and paint miniatures. React + Vite client, Fastify + SQLite server,
shared zod schemas, one Docker container. Code and UI in English; the owner writes in Italian.

## Testing is not optional

The owner asked Claude to act as the project's tester. For every change, before saying it is done:

1. Run the whole suite and make it pass:
   ```
   npm run test:all
   ```
   (typecheck, unit/API tests, build, browser tests on desktop and phone, PIN lock last).
2. Add or update tests for what changed:
   - server behaviour → `server/test/*.test.ts` (node:test, `app.inject`)
   - pure client logic → `client/test/*.test.ts`
   - anything a person does in the browser → `e2e/specs/*.spec.ts` (Playwright); tag with `@phone` if it
     matters on a phone.
3. A failing test is fixed at its root. Never skip, delete or weaken a test to get green; if a test is wrong,
   say why when changing it.
4. Watch CI on the pull request (`.github/workflows/ci.yml`) and fix anything red before handing over.
5. Report results plainly: what ran, how many passed, what could not be tested (real AI key, real phone, NAS).

The e2e server runs on a throwaway data folder with `AI_PROVIDER=mock`, so tests never call a paid API.
`docs/testing.md` lists what the suite covers and the manual checks that remain.
