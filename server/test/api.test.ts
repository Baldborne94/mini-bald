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
  app = await buildApp(loadConfig({ DATA_DIR: dataDir, LOG: 'off', CLIENT_DIST: path.join(dataDir, 'no-client') }));
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
  assert.equal(body.schemaVersion, 2);
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
