import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import type { FastifyInstance } from 'fastify';
import sharp from 'sharp';
import { buildApp } from '../src/app.ts';
import { loadConfig } from '../src/config.ts';

let app: FastifyInstance;
let dataDir: string;

before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minibald-'));
  app = await buildApp(loadConfig({ DATA_DIR: dataDir, LOG: 'off', CLIENT_DIST: path.join(dataDir, 'no-client'), AI_PROVIDER: 'mock', BACKUP_KEEP: '0' }));
});
after(async () => {
  await app.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

const json = async (method: string, url: string, payload?: unknown) => {
  const res = await app.inject({ method: method as 'GET', url, payload: payload as object });
  return { status: res.statusCode, body: res.body ? res.json() : null };
};

async function upload(miniId: number) {
  const image = await sharp({ create: { width: 640, height: 480, channels: 3, background: '#d81e6f' } }).jpeg().toBuffer();
  const form = new FormData();
  form.append('file', new Blob([image], { type: 'image/jpeg' }), 'shot.jpg');
  const encoded = new Response(form);
  const res = await app.inject({
    method: 'POST',
    url: `/api/miniatures/${miniId}/photos`,
    payload: Buffer.from(await encoded.arrayBuffer()),
    headers: { 'content-type': encoded.headers.get('content-type')! },
  });
  assert.equal(res.statusCode, 201, res.body);
  return res.json()[0] as { id: number; path: string; width: number };
}

test('migrations run once and are recorded', async () => {
  const { body } = await json('GET', '/api/health');
  assert.equal(body.ok, true);
  assert.equal(body.schemaVersion, 4);
});

test('groups: create, one-level nesting, validation', async () => {
  const parent = await json('POST', '/api/groups', { name: 'Warhammer 40K', kind: 'Game system', color: '#2b3fe0' });
  assert.equal(parent.status, 201);
  assert.equal(parent.body.slug, 'warhammer-40k');
  const child = await json('POST', '/api/groups', { name: 'Ultramarines', parentId: parent.body.id });
  assert.equal(child.status, 201);
  const tooDeep = await json('POST', '/api/groups', { name: 'Second Company', parentId: child.body.id });
  assert.equal(tooDeep.status, 400);
  assert.equal((await json('POST', '/api/groups', { name: '  ' })).status, 400);
  assert.equal((await json('POST', '/api/groups', { name: 'Warhammer 40k!' })).body.slug, 'warhammer-40k-2');
});

test('miniatures: lifecycle, tags, filters, photo folders follow renames', async () => {
  const groups = (await json('GET', '/api/groups')).body as { id: number; slug: string }[];
  const ultras = groups.find((g) => g.slug === 'ultramarines')!;
  const w40k = groups.find((g) => g.slug === 'warhammer-40k')!;

  const created = await json('POST', '/api/miniatures', {
    name: 'Intercessor Squad',
    groupId: ultras.id,
    quantity: 10,
    tags: ['Infantry', 'infantry', 'Kill Team'],
  });
  assert.equal(created.status, 201);
  const id = created.body.id as number;
  assert.deepEqual(created.body.tags, ['Infantry', 'Kill Team']);
  assert.equal(created.body.folder, `photos/ultramarines/intercessor-squad-${id}`);

  await json('POST', '/api/miniatures', { name: 'Loose goblin', status: 'primed' });

  // Photo lands in a readable folder and thumbnails are generated on demand.
  const photo = await upload(id);
  assert.match(photo.path, new RegExp(`^photos/ultramarines/intercessor-squad-${id}/\\d{4}-\\d{2}-\\d{2}_\\d{6}_unassembled\\.jpg$`));
  assert.equal(photo.width, 640);
  assert.ok(fs.existsSync(path.join(dataDir, photo.path)));
  const thumb = await app.inject({ url: `/api/media/thumbs/${photo.id}?w=200` });
  assert.equal(thumb.statusCode, 200);
  assert.equal(thumb.headers['content-type'], 'image/webp');
  assert.equal((await app.inject({ url: `/api/media/photos/${photo.id}` })).statusCode, 200);

  // Renaming the miniature and then its group moves the folder and rewrites the paths.
  const renamed = await json('PATCH', `/api/miniatures/${id}`, { name: 'Intercessors Alpha' });
  assert.equal(renamed.body.photos[0].path.startsWith(`photos/ultramarines/intercessors-alpha-${id}/`), true);
  assert.ok(fs.existsSync(path.join(dataDir, renamed.body.photos[0].path)));
  assert.equal(fs.existsSync(path.join(dataDir, photo.path)), false);

  await json('PATCH', `/api/groups/${ultras.id}`, { name: 'Ultramarines 2nd Co.' });
  let mini = (await json('GET', `/api/miniatures/${id}`)).body;
  assert.equal(mini.photos[0].path.startsWith(`photos/ultramarines-2nd-co/intercessors-alpha-${id}/`), true);
  assert.ok(fs.existsSync(path.join(dataDir, mini.photos[0].path)));
  assert.equal(mini.coverPhotoId, photo.id);

  // Status changes keep history and dates.
  const finished = await json('POST', `/api/miniatures/${id}/status`, { status: 'finished' });
  assert.equal(finished.body.miniature.status, 'finished');
  assert.ok(finished.body.miniature.finishedAt);
  assert.deepEqual(finished.body.unlocked, []);

  // Filters: parent group includes sub-groups; tag and search are case-insensitive.
  const list = async (qs: string) => ((await json('GET', `/api/miniatures?${qs}`)).body.items as { name: string }[]).map((m) => m.name);
  assert.deepEqual(await list(`group=${w40k.id}`), ['Intercessors Alpha']);
  assert.deepEqual(await list('group=none'), ['Loose goblin']);
  assert.deepEqual(await list('tag=kill%20team'), ['Intercessors Alpha']);
  assert.deepEqual(await list('q=GOBLIN'), ['Loose goblin']);
  assert.deepEqual(await list('status=primed,assembled'), ['Loose goblin']);
  assert.equal((await json('GET', '/api/miniatures/random')).body.miniature.name, 'Loose goblin');

  const dash = (await json('GET', '/api/dashboard')).body;
  assert.equal(dash.totalModels, 11);
  assert.equal(dash.pile, 1);
  assert.equal(dash.finishedThisMonth, 10);
  assert.equal(dash.continueWith.name, 'Loose goblin');
  assert.equal(dash.groups[0].name, 'Warhammer 40K');
  assert.equal(dash.groups[0].counts.finished, 10);

  // Deleting the group ungroups the miniature; deleting the miniature moves photos to trash.
  assert.equal((await json('DELETE', `/api/groups/${ultras.id}`)).status, 204);
  mini = (await json('GET', `/api/miniatures/${id}`)).body;
  assert.equal(mini.group, null);
  assert.equal(mini.photos[0].path.startsWith(`photos/_ungrouped/intercessors-alpha-${id}/`), true);
  assert.ok(fs.existsSync(path.join(dataDir, mini.photos[0].path)));

  assert.equal((await json('DELETE', `/api/miniatures/${id}`)).status, 204);
  assert.equal(fs.existsSync(path.join(dataDir, mini.folder)), false);
  assert.equal(fs.readdirSync(path.join(dataDir, 'trash')).length, 1);
  assert.equal((await json('GET', `/api/miniatures/${id}`)).status, 404);
  assert.deepEqual((await json('GET', '/api/tags')).body, []);
});

test('uploads reject non-images', async () => {
  const mini = (await json('POST', '/api/miniatures', { name: 'Test' })).body;
  const form = new FormData();
  form.append('file', new Blob(['not an image'], { type: 'image/jpeg' }), 'x.jpg');
  const encoded = new Response(form);
  const res = await app.inject({
    method: 'POST',
    url: `/api/miniatures/${mini.id}/photos`,
    payload: Buffer.from(await encoded.arrayBuffer()),
    headers: { 'content-type': encoded.headers.get('content-type')! },
  });
  assert.equal(res.statusCode, 415);
});

test('paints and shopping list stay in step', async () => {
  const paint = await json('POST', '/api/paints', { brand: 'Citadel', range: 'Base', name: 'Macragge Blue', type: 'base', colorHex: '#0d407f' });
  assert.equal(paint.status, 201);
  assert.equal(paint.body.onShoppingList, false);
  assert.equal((await json('POST', '/api/paints', { brand: 'citadel', range: 'base', name: 'macragge blue' })).status, 409);

  // Running low puts it on the list; buying it restocks it.
  const low = await json('PATCH', `/api/paints/${paint.body.id}`, { stock: 'low' });
  assert.equal(low.body.onShoppingList, true);
  let list = (await json('GET', '/api/shopping')).body;
  assert.equal(list.length, 1);
  assert.equal(list[0].paint.name, 'Macragge Blue');
  await json('PATCH', `/api/shopping/${list[0].id}`, { bought: true });
  const restocked = (await json('GET', '/api/paints?q=macragge')).body[0];
  assert.equal(restocked.stock, 'owned');
  assert.equal(restocked.onShoppingList, false);

  // Free-text items are de-duplicated; bought items can be cleared.
  await json('POST', '/api/shopping', { label: 'Size 1 brush' });
  await json('POST', '/api/shopping', { label: 'size 1 brush' });
  assert.equal((await json('POST', '/api/shopping', {})).status, 400);
  assert.equal((await json('DELETE', '/api/shopping/bought')).status, 204);
  list = (await json('GET', '/api/shopping')).body;
  assert.deepEqual(list.map((i: { label: string }) => i.label), ['Size 1 brush']);
  assert.equal((await json('GET', '/api/paints?stock=wanted,out')).body.length, 0);
});

test('recipes: steps keep their ticks through edits and are copied clean', async () => {
  const paint = (await json('GET', '/api/paints')).body[0];
  const a = (await json('POST', '/api/miniatures', { name: 'Recipe mini A' })).body;
  const b = (await json('POST', '/api/miniatures', { name: 'Recipe mini B' })).body;

  const created = await json('POST', '/api/recipes', {
    name: 'Blue armour',
    miniatureId: a.id,
    steps: [
      { phase: 'base', area: 'Armour', paintId: paint.id, technique: 'Basecoat' },
      { phase: 'shade', area: 'Armour', paintLabel: 'Nuln Oil', technique: 'Recess wash' },
    ],
  });
  assert.equal(created.status, 201);
  const [base, shade] = created.body.steps;
  assert.equal(base.paint.name, 'Macragge Blue');
  assert.equal(base.paintLabel, 'Citadel Macragge Blue');
  assert.equal(shade.paint, null);

  const ticked = await json('PATCH', `/api/recipe-steps/${base.id}`, { done: true });
  assert.ok(ticked.body.steps[0].doneAt);

  // Reorder, edit and add a step: the ticked step keeps its tick.
  const edited = await json('PATCH', `/api/recipes/${created.body.id}`, {
    steps: [
      { id: shade.id, phase: 'shade', area: 'Armour', paintLabel: 'Nuln Oil' },
      { id: base.id, phase: 'base', area: 'Armour plates', paintId: paint.id },
      { phase: 'highlight', paintLabel: 'Calgar Blue' },
    ],
  });
  assert.deepEqual(edited.body.steps.map((s: { phase: string }) => s.phase), ['shade', 'base', 'highlight']);
  assert.ok(edited.body.steps[1].doneAt);
  assert.equal(edited.body.steps[1].area, 'Armour plates');
  assert.equal(edited.body.steps[0].doneAt, null);

  // Copy to another miniature and to the library: no ticks, origin recorded.
  const copy = await json('POST', `/api/recipes/${created.body.id}/duplicate`, { miniatureId: b.id });
  assert.equal(copy.status, 201);
  assert.equal(copy.body.source, 'copy');
  assert.equal(copy.body.sourceRecipeId, created.body.id);
  assert.equal(copy.body.steps.length, 3);
  assert.ok(copy.body.steps.every((s: { doneAt: string | null }) => s.doneAt === null));
  await json('POST', `/api/recipes/${created.body.id}/duplicate`, { miniatureId: null, name: 'Ultramarine blue' });
  assert.deepEqual((await json('GET', '/api/recipes')).body.map((r: { name: string }) => r.name), ['Ultramarine blue']);
  assert.equal((await json('GET', `/api/recipes?miniature=${b.id}`)).body.length, 1);

  // Deleting a paint keeps the step, with its label.
  await json('DELETE', `/api/paints/${paint.id}`);
  const after = (await json('GET', `/api/recipes/${created.body.id}`)).body;
  assert.equal(after.steps[1].paint, null);
  assert.equal(after.steps[1].paintLabel, 'Citadel Macragge Blue');

  // Recipes go away with their miniature.
  await json('DELETE', `/api/miniatures/${a.id}`);
  assert.equal((await json('GET', `/api/recipes/${created.body.id}`)).status, 404);
});

test('sessions: one timer at a time, totals reach the miniature and dashboard', async () => {
  const a = (await json('POST', '/api/miniatures', { name: 'Timer mini A' })).body;
  const b = (await json('POST', '/api/miniatures', { name: 'Timer mini B' })).body;
  assert.equal((await json('GET', '/api/sessions/active')).body.session, null);

  const first = await json('POST', '/api/sessions/start', { miniatureId: a.id });
  assert.equal(first.status, 201);
  assert.equal((await json('GET', '/api/sessions/active')).body.session.miniatureName, 'Timer mini A');

  // Starting another stops the first.
  await json('POST', '/api/sessions/start', { miniatureId: b.id });
  const history = (await json('GET', `/api/sessions?miniature=${a.id}`)).body;
  assert.equal(history.length, 1);
  assert.ok(history[0].endedAt);
  assert.ok(history[0].durationSec >= 1);

  const stopped = await json('POST', '/api/sessions/stop', { notes: 'Edge highlights' });
  assert.equal(stopped.body.session.notes, 'Edge highlights');
  assert.equal((await json('POST', '/api/sessions/stop')).body.session, null);

  // A session logged by hand, then corrected.
  const end = new Date();
  const start = new Date(end.getTime() - 90 * 60 * 1000);
  const manual = await json('POST', '/api/sessions', { miniatureId: a.id, startedAt: start.toISOString(), endedAt: end.toISOString() });
  assert.equal(manual.body.durationSec, 5400);
  assert.equal((await json('PATCH', `/api/sessions/${manual.body.id}`, { durationSec: 3600 })).body.durationSec, 3600);
  assert.equal((await json('POST', '/api/sessions', { startedAt: end.toISOString(), endedAt: start.toISOString() })).status, 400);

  const mini = (await json('GET', `/api/miniatures/${a.id}`)).body;
  assert.ok(mini.paintedSeconds >= 3601);
  const dash = (await json('GET', '/api/dashboard')).body;
  assert.ok(dash.paintedSecondsThisMonth >= 3602);
  assert.ok(dash.paintedSecondsTotal >= dash.paintedSecondsThisMonth);
});

test('catalogue, bulk add and CSV export', async () => {
  fs.writeFileSync(
    path.join(dataDir, 'catalogs', 'test.json'),
    JSON.stringify([
      { brand: 'Testors', range: 'Basics', name: 'Sky Blue', type: 'Base', hex: '#66aaff' },
      { brand: 'Testors', range: 'Basics', name: 'Mud, "Wet"' },
      { brand: 'Testors', range: 'Basics', name: 'Sky Blue' },
    ]),
  );
  fs.writeFileSync(path.join(dataDir, 'catalogs', 'broken.json'), '{ not json');
  const mine = () => json('GET', '/api/catalog').then((r) => (r.body as { brand: string; name: string; paintId: number | null }[]).filter((e) => e.brand === 'Testors'));
  assert.deepEqual((await mine()).map((e) => [e.name, e.paintId]), [['Sky Blue', null], ['Mud, "Wet"', null]]);

  const items = [
    { brand: 'Testors', range: 'Basics', name: 'Sky Blue', type: 'Base', colorHex: '#66aaff' },
    { brand: 'Testors', range: 'Basics', name: 'Mud, "Wet"', stock: 'wanted' },
  ];
  assert.deepEqual((await json('POST', '/api/paints/bulk', { items })).body, { added: 2, skipped: 0 });
  assert.deepEqual((await json('POST', '/api/paints/bulk', { items })).body, { added: 0, skipped: 2 });
  assert.ok((await mine()).every((e) => e.paintId !== null));
  // A wished-for paint from a bulk add lands on the shopping list like any other.
  assert.ok((await json('GET', '/api/shopping')).body.some((i: { paint: { name: string } | null }) => i.paint?.name === 'Mud, "Wet"'));

  const csv = await app.inject({ url: '/api/paints/export.csv' });
  assert.match(csv.headers['content-type'] as string, /text\/csv/);
  assert.ok(csv.body.includes('Testors,Basics,Sky Blue,Base,#66aaff,owned,'));
  assert.ok(csv.body.includes('Testors,Basics,"Mud, ""Wet""",,,wanted,'));
});

test('AI assistant: validated suggestions become recipes, feedback needs a photo', async () => {
  assert.deepEqual((await json('GET', '/api/ai/status')).body, { configured: true, provider: 'mock', model: 'mock-1' });
  const mini = (await json('POST', '/api/miniatures', { name: 'AI mini', tags: ['Character'] })).body;
  const mine = (await json('POST', '/api/paints', { brand: 'Aardvark', name: 'First Blue', colorHex: '#123456' })).body;
  const photo = await upload(mini.id);

  // Recipe: owned paints are matched against the inventory by the backend, not by the model.
  const suggestion = await json('POST', '/api/ai/recipe', { miniatureId: mini.id, scheme: 'Blue', photoId: photo.id });
  assert.equal(suggestion.status, 200, JSON.stringify(suggestion.body));
  assert.equal(suggestion.body.kind, 'recipe');
  assert.equal(suggestion.body.prompt, 'Blue');
  assert.equal(suggestion.body.savedRecipeId, null);
  const steps = suggestion.body.output.steps;
  assert.equal(steps[0].paintRef, null);
  assert.equal(steps[0].paint, 'Mock Black Primer');
  // The mock picks the first owned paint; whichever it is, it must resolve to an inventory entry.
  const matched = steps[1].paintRef;
  assert.ok(matched && mine.id);
  assert.equal(steps[1].paint, `${matched.brand} ${matched.name}`);
  assert.equal(steps[3].paint, null);

  const saved = await json('POST', `/api/ai/runs/${suggestion.body.id}/save-recipe`);
  assert.equal(saved.status, 201);
  const recipe = (await json('GET', `/api/recipes/${saved.body.recipeId}`)).body;
  assert.equal(recipe.source, 'ai');
  assert.equal(recipe.miniatureId, mini.id);
  assert.equal(recipe.steps.length, 4);
  assert.equal(recipe.steps[1].paint.id, matched.id);
  assert.equal(recipe.steps[0].paint, null);
  assert.ok(recipe.steps[0].notes.includes(`Substitute from your paints: ${matched.brand} ${matched.name}.`));
  // Saving twice returns the same recipe instead of creating another.
  assert.equal((await json('POST', `/api/ai/runs/${suggestion.body.id}/save-recipe`)).body.recipeId, saved.body.recipeId);

  // Feedback: photo is required and must belong to the miniature.
  assert.equal((await json('POST', '/api/ai/feedback', { miniatureId: mini.id })).status, 400);
  const other = (await json('POST', '/api/miniatures', { name: 'Other mini' })).body;
  assert.equal((await json('POST', '/api/ai/feedback', { miniatureId: other.id, photoId: photo.id })).status, 400);
  const feedback = await json('POST', '/api/ai/feedback', { miniatureId: mini.id, photoId: photo.id, focus: 'Cloak' });
  assert.equal(feedback.body.output.improvements[0].area, 'Cloak');

  const tutorials = await json('POST', '/api/ai/tutorials', { miniatureId: mini.id });
  assert.equal(tutorials.body.output.links[0].url, 'https://example.com/guide');

  const runs = (await json('GET', `/api/ai/runs?miniature=${mini.id}`)).body;
  assert.deepEqual(runs.map((r: { kind: string }) => r.kind), ['tutorials', 'feedback', 'recipe']);
  assert.equal(runs[2].savedRecipeId, saved.body.recipeId);
  assert.equal((await json('DELETE', `/api/ai/runs/${tutorials.body.id}`)).status, 204);
  assert.equal((await json('GET', `/api/ai/runs?miniature=${mini.id}`)).body.length, 2);
});

test('AI assistant: without a key the app works and the endpoints say why', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'minibald-noai-'));
  const plain = await buildApp(loadConfig({ DATA_DIR: dir, LOG: 'off', CLIENT_DIST: path.join(dir, 'x'), BACKUP_KEEP: '0' }));
  try {
    assert.equal((await plain.inject({ url: '/api/ai/status' })).json().configured, false);
    assert.equal((await plain.inject({ url: '/api/health' })).json().aiConfigured, false);
    const mini = (await plain.inject({ method: 'POST', url: '/api/miniatures', payload: { name: 'X' } })).json();
    const res = await plain.inject({ method: 'POST', url: '/api/ai/tutorials', payload: { miniatureId: mini.id } });
    assert.equal(res.statusCode, 503);
    assert.match(res.json().error, /ANTHROPIC_API_KEY/);
  } finally {
    await plain.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('motivation: streaks, badges unlocked once, challenges measured from real data', async () => {
  const badge = async (key: string) => ((await json('GET', '/api/achievements')).body as { key: string; unlockedAt: string | null; seen: boolean; progress: { current: number; target: number } }[]).find((a) => a.key === key)!;

  // Three painting days in a row ending today, logged after the fact.
  const mini = (await json('POST', '/api/miniatures', { name: 'Streak mini', status: 'primed' })).body;
  const before = (await json('GET', '/api/streak')).body;
  for (const daysAgo of [2, 1, 0]) {
    const end = new Date(Date.now() - daysAgo * 86_400_000);
    await json('POST', '/api/sessions', { miniatureId: mini.id, startedAt: new Date(end.getTime() - 20 * 60_000).toISOString(), endedAt: end.toISOString() });
  }
  const streak = (await json('GET', '/api/streak')).body;
  assert.ok(streak.current >= 3 && streak.best >= 3 && streak.current >= before.current);
  assert.equal(streak.paintedToday, true);
  assert.equal(streak.recent.length, 14);
  assert.deepEqual(streak.recent.slice(-3).map((d: { active: boolean }) => d.active), [true, true, true]);
  assert.ok((await badge('streak_3')).unlockedAt);

  // A fresh badge is unseen until acknowledged, and stays unlocked afterwards.
  assert.equal((await badge('first_finished')).unlockedAt, null);
  await json('POST', `/api/miniatures/${mini.id}/status`, { status: 'finished' });
  assert.ok((await badge('first_finished')).unlockedAt);
  const unseen = ((await json('GET', '/api/achievements')).body as { key: string; unlockedAt: string | null; seen: boolean }[]).filter((a) => a.unlockedAt && !a.seen).map((a) => a.key);
  assert.ok(unseen.includes('streak_3'));
  await json('POST', '/api/achievements/seen', { keys: unseen });
  assert.equal((await badge('streak_3')).seen, true);
  assert.equal((await badge('finished_100')).unlockedAt, null);
  assert.ok((await badge('finished_100')).progress.current < 100);

  // Challenges: specific miniatures, and a count within the period.
  const target = (await json('POST', '/api/miniatures', { name: 'Challenge mini', quantity: 3 })).body;
  const specific = await json('POST', '/api/challenges', { title: 'Finish the squad', kind: 'finish_miniatures', miniatureIds: [target.id, 999999] });
  assert.equal(specific.status, 201);
  assert.deepEqual(specific.body.progress, { current: 0, target: 1, unit: 'models' });
  assert.equal(specific.body.state, 'active');
  const counted = (await json('POST', '/api/challenges', { title: 'Three this month', kind: 'finish_count', target: 3, dueOn: '2999-01-01' })).body;
  assert.ok(counted.progress.current <= 1, 'only models finished inside the period count');
  const countedBefore = counted.progress.current;
  assert.ok(counted.daysLeft > 0);
  assert.equal((await json('POST', '/api/challenges', { title: 'No target', kind: 'paint_hours' })).status, 400);
  assert.equal((await json('POST', '/api/challenges', { title: 'Backwards', kind: 'paint_hours', target: 2, dueOn: '2000-01-01' })).status, 400);

  await json('POST', `/api/miniatures/${target.id}/status`, { status: 'finished' });
  // The badge for winning a challenge does not depend on the challenges being listed first.
  assert.ok((await badge('challenge_won')).unlockedAt);
  const after = (await json('GET', '/api/challenges')).body as { id: number; state: string; progress: { current: number }; completedAt: string | null }[];
  assert.equal(after.find((c) => c.id === specific.body.id)!.state, 'completed');
  assert.equal(after.find((c) => c.id === counted.id)!.progress.current, countedBefore + 3);
  assert.ok(after.find((c) => c.id === counted.id)!.completedAt);
  assert.ok((await badge('challenge_won')).unlockedAt);

  // Un-finishing the miniature does not take a completed challenge or a badge away.
  await json('POST', `/api/miniatures/${target.id}/status`, { status: 'in_progress' });
  assert.equal((await json('GET', '/api/challenges')).body.find((c: { id: number }) => c.id === counted.id).state, 'completed');
  assert.ok((await badge('challenge_won')).unlockedAt);

  const abandoned = await json('PATCH', `/api/challenges/${specific.body.id}`, { abandoned: true });
  assert.equal(abandoned.body.state, 'abandoned');
  assert.equal((await json('DELETE', `/api/challenges/${specific.body.id}`)).status, 204);

  const stats = (await json('GET', '/api/stats')).body;
  assert.equal(stats.months.length, 12);
  assert.equal(stats.months.at(-1).month, new Date().toISOString().slice(0, 7));
  assert.ok(stats.months.at(-1).paintedSeconds >= 1200);
  assert.ok(stats.totals.sessions >= 3 && stats.totals.longestSessionSeconds >= 1200);
  assert.ok(stats.topMiniatures.length > 0);
});

test('backups and exports', async () => {
  const info = (await json('GET', '/api/backup')).body;
  assert.ok(info.databaseBytes > 0);
  assert.equal(info.keep, 0);
  assert.deepEqual(info.automatic, []);

  const dbCopy = await app.inject({ url: '/api/backup/database' });
  assert.equal(dbCopy.statusCode, 200);
  assert.match(dbCopy.headers['content-disposition'] as string, /minibald-\d{4}-\d{2}-\d{2}\.db/);
  assert.equal(dbCopy.rawPayload.subarray(0, 15).toString(), 'SQLite format 3');

  const mini = (await json('POST', '/api/miniatures', { name: 'Backup, "mini"', tags: ['A', 'B'] })).body;
  const photo = await upload(mini.id);
  const zip = await app.inject({ url: '/api/backup/full' });
  assert.equal(zip.statusCode, 200);
  assert.equal(zip.rawPayload.subarray(0, 2).toString(), 'PK');
  // File names are stored as plain text in a zip's directory.
  const names = zip.rawPayload.toString('latin1');
  assert.ok(names.includes('minis.db'));
  assert.ok(names.includes(photo.path));
  assert.ok(names.includes('catalogs/test.json'));
  assert.deepEqual(fs.readdirSync(path.join(dataDir, 'backups', 'tmp')), [], 'temporary snapshots are removed');

  const csv = await app.inject({ url: '/api/miniatures/export.csv' });
  assert.ok(csv.body.includes('name,group,status,models,tags'));
  assert.ok(csv.body.includes('"Backup, ""mini""",,To build,1,A; B,'));
});

test('automatic daily database backups are written and pruned', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'minibald-auto-'));
  fs.mkdirSync(path.join(dir, 'backups', 'auto'), { recursive: true });
  for (const day of ['2020-01-01', '2020-01-02', '2020-01-03']) fs.writeFileSync(path.join(dir, 'backups', 'auto', `minis_${day}.db`), 'old');
  const auto = await buildApp(loadConfig({ DATA_DIR: dir, LOG: 'off', CLIENT_DIST: path.join(dir, 'x'), BACKUP_KEEP: '2' }));
  try {
    // Closing waits for the snapshot that started at boot.
    await auto.close();
    const files = fs.readdirSync(path.join(dir, 'backups', 'auto')).sort();
    assert.equal(files.length, 2);
    assert.equal(files[0], 'minis_2020-01-03.db');
    assert.match(files[1]!, /^minis_\d{4}-\d{2}-\d{2}\.db$/);
    assert.equal(fs.readFileSync(path.join(dir, 'backups', 'auto', files[1]!)).subarray(0, 15).toString(), 'SQLite format 3');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('PIN lock: guards the API and photos, throttles guesses, can be changed and reset', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'minibald-pin-'));
  const env = { DATA_DIR: dir, LOG: 'off', CLIENT_DIST: path.join(dir, 'x'), BACKUP_KEEP: '0' };
  let locked = await buildApp(loadConfig(env));
  const call = (method: string, url: string, payload?: unknown, cookie?: string) =>
    locked.inject({ method: method as 'GET', url, payload: payload as object, headers: cookie ? { cookie } : {} });
  const cookieOf = (res: { headers: Record<string, unknown> }) => String(res.headers['set-cookie']).split(';')[0]!;
  try {
    assert.deepEqual((await call('GET', '/api/auth/status')).json(), { pinEnabled: false, unlocked: true });
    assert.equal((await call('PUT', '/api/auth/pin', { newPin: '12' })).statusCode, 400);

    const set = await call('PUT', '/api/auth/pin', { newPin: '2468' });
    assert.equal(set.statusCode, 200);
    const session = cookieOf(set);
    assert.match(String(set.headers['set-cookie']), /HttpOnly; SameSite=Lax/);
    assert.equal(String(set.headers['set-cookie']).includes('Secure'), false, 'plain HTTP: no Secure flag');

    // Without the cookie everything is closed except health and the auth endpoints.
    for (const url of ['/api/miniatures', '/api/dashboard', '/api/media/photos/1', '/api/backup/database', '/api/settings']) {
      assert.equal((await call('GET', url)).statusCode, 401, url);
    }
    assert.equal((await call('GET', '/api/health')).statusCode, 200);
    assert.deepEqual((await call('GET', '/api/auth/status')).json(), { pinEnabled: true, unlocked: false });
    assert.equal((await call('GET', '/api/miniatures', undefined, session)).statusCode, 200);
    assert.equal((await call('GET', '/api/miniatures', undefined, 'mb_session=9999999999999.forged')).statusCode, 401);
    // The PIN hash and signing secret are never readable, even when unlocked.
    assert.deepEqual((await call('GET', '/api/settings', undefined, session)).json(), {});
    assert.equal((await call('PUT', '/api/settings', { 'auth.pin': null }, session)).statusCode, 400);

    assert.equal((await call('POST', '/api/auth/unlock', { pin: '0000' })).statusCode, 401);
    const unlock = await call('POST', '/api/auth/unlock', { pin: '2468' });
    assert.equal(unlock.statusCode, 200);
    assert.equal((await call('GET', '/api/miniatures', undefined, cookieOf(unlock))).statusCode, 200);

    // Changing needs the current PIN, and signs out the other devices.
    assert.equal((await call('PUT', '/api/auth/pin', { currentPin: '1111', newPin: '1357' }, session)).statusCode, 403);
    const changed = await call('PUT', '/api/auth/pin', { currentPin: '2468', newPin: '1357' }, session);
    assert.equal(changed.statusCode, 200);
    assert.equal((await call('GET', '/api/miniatures', undefined, session)).statusCode, 401);
    assert.equal((await call('GET', '/api/miniatures', undefined, cookieOf(changed))).statusCode, 200);

    // Five wrong guesses in a row lock even the right PIN out for a while.
    for (let i = 0; i < 5; i++) await call('POST', '/api/auth/unlock', { pin: 'nope' });
    const throttled = await call('POST', '/api/auth/unlock', { pin: '1357' });
    assert.equal(throttled.statusCode, 429);
    assert.ok(Number(throttled.headers['retry-after']) > 0);

    // A forgotten PIN is removed by starting once with RESET_PIN.
    await locked.close();
    locked = await buildApp(loadConfig({ ...env, RESET_PIN: 'true' }));
    assert.deepEqual((await call('GET', '/api/auth/status')).json(), { pinEnabled: false, unlocked: true });
    assert.equal((await call('GET', '/api/miniatures')).statusCode, 200);
  } finally {
    await locked.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('insights, activity calendar and year recap', async () => {
  const year = new Date().getFullYear();
  const used = (await json('POST', '/api/paints', { brand: 'Insight', name: 'Used Red', colorHex: '#aa0000' })).body;
  const unused = (await json('POST', '/api/paints', { brand: 'Insight', name: 'Dusty Green', colorHex: '#00aa00' })).body;
  const mini = (await json('POST', '/api/miniatures', { name: 'Insight mini', quantity: 2, status: 'in_progress' })).body;
  const recipe = (await json('POST', '/api/recipes', { name: 'Reds', miniatureId: mini.id, steps: [{ phase: 'base', paintId: used.id }] })).body;
  await json('PATCH', `/api/recipe-steps/${recipe.steps[0].id}`, { done: true });
  await json('POST', `/api/miniatures/${mini.id}/status`, { status: 'finished' });

  const insights = (await json('GET', '/api/insights')).body;
  // The same paint all day, taken from the inventory.
  assert.ok(insights.colourOfDay.paint.id > 0);
  assert.deepEqual((await json('GET', '/api/insights')).body.colourOfDay, insights.colourOfDay);
  const forgottenIds = ((await json('GET', '/api/paints')).body as { id: number; usedInSteps: number; stock: string }[]).filter((p) => p.usedInSteps === 0 && ['owned', 'low'].includes(p.stock)).map((p) => p.id);
  assert.equal(insights.forgotten.count, forgottenIds.length);
  assert.ok(forgottenIds.includes(unused.id) && !forgottenIds.includes(used.id));
  assert.ok(insights.forgotten.sample.length <= 8);
  // Models were finished in the last 90 days, so there is a pace; a date only if a pile remains.
  assert.ok(insights.pileZero.modelsPerMonth > 0);
  assert.equal(insights.pileZero.date === null, insights.pileZero.pile === 0);

  const activity = (await json('GET', `/api/activity?year=${year}`)).body;
  assert.equal(activity.days[0].day, `${year}-01-01`);
  const today = activity.days.at(-1);
  assert.equal(today.active, true);
  assert.ok(today.seconds >= 1200, 'sessions logged today by an earlier test');
  assert.ok(activity.years.includes(year));
  assert.equal((await json('GET', '/api/activity?year=abc')).status, 400);

  const recap = (await json('GET', `/api/recap?year=${year}`)).body;
  assert.ok(recap.finishedModels >= 2 && recap.finishedCards >= 1);
  assert.ok(recap.finished.some((m: { id: number }) => m.id === mini.id));
  assert.ok(recap.daysPainted >= 3 && recap.bestStreak >= 3);
  assert.ok(recap.topPaints.some((p: { label: string; colorHex: string }) => p.label === 'Insight Used Red' && p.colorHex === '#aa0000'));
  assert.ok(recap.badges.some((b: { key: string }) => b.key === 'first_finished'));
  assert.ok(recap.busiestMonth.paintedSeconds > 0);
  const empty = (await json('GET', '/api/recap?year=2001')).body;
  assert.deepEqual([empty.finishedModels, empty.sessions, empty.daysPainted, empty.busiestMonth, empty.finished.length], [0, 0, 0, null, 0]);
});

test('bundled catalogue files are well formed', async () => {
  const bundled = ((await json('GET', '/api/catalog')).body as { brand: string; range: string; name: string; code: string | null; hex: string | null }[]).filter((e) => e.brand !== 'Testors');
  const count = (brand: string, range?: string) => bundled.filter((e) => e.brand === brand && (range === undefined || e.range === range)).length;
  assert.equal(count('Citadel'), 398);
  assert.equal(count('AK Interactive'), 241);
  assert.equal(count('The Army Painter', 'Warpaints Fanatic'), 216);
  assert.equal(count('The Army Painter', 'Speedpaint 2.0'), 90);
  // Every entry is unique by brand, range and name: that is how ownership is matched.
  assert.equal(new Set(bundled.map((e) => `${e.brand}|${e.range}|${e.name}`.toLowerCase())).size, bundled.length);
  const speed = bundled.filter((e) => e.range === 'Speedpaint 2.0');
  assert.ok(speed.every((e) => /^WP2\d{3}$/.test(e.code ?? '')));
  assert.ok(speed.some((e) => e.name === 'Grim Black') && speed.some((e) => e.name === 'Hoplite Gold'));
});
