import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import type { FastifyInstance } from 'fastify';
import sharp from 'sharp';
import { buildApp } from '../src/app.ts';
import { loadConfig } from '../src/config.ts';

// Edge cases and validation: each test sets up what it needs on its own app instance.

let app: FastifyInstance;
let dataDir: string;

before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minibald-edge-'));
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
  const image = await sharp({ create: { width: 64, height: 64, channels: 3, background: '#336699' } }).jpeg().toBuffer();
  const form = new FormData();
  form.append('file', new Blob([image], { type: 'image/jpeg' }), 'a.jpg');
  const encoded = new Response(form);
  const res = await app.inject({
    method: 'POST',
    url: `/api/miniatures/${miniId}/photos`,
    payload: Buffer.from(await encoded.arrayBuffer()),
    headers: { 'content-type': encoded.headers.get('content-type')! },
  });
  return res.json()[0] as { id: number; path: string };
}

test('input validation answers 400 with a readable message', async () => {
  const bad = [
    ['POST', '/api/miniatures', { name: '' }],
    ['POST', '/api/miniatures', { name: 'x', quantity: 0 }],
    ['POST', '/api/miniatures', { name: 'x', status: 'painted' }],
    ['POST', '/api/miniatures', { name: 'x', groupId: 999999 }],
    ['POST', '/api/groups', { name: 'x', color: 'red' }],
    ['POST', '/api/paints', { brand: 'A', name: 'B', colorHex: '#12345' }],
    ['POST', '/api/paints', { brand: 'A', name: 'B', stock: 'plenty' }],
    ['POST', '/api/recipes', { name: 'R', steps: [{ phase: 'glazing' }] }],
    ['POST', '/api/sessions', { startedAt: 'yesterday', endedAt: 'today' }],
    ['GET', '/api/miniatures/abc', undefined],
    ['GET', '/api/miniatures?group=abc', undefined],
  ] as const;
  for (const [method, url, body] of bad) {
    const res = await json(method, url, body);
    assert.equal(res.status, 400, `${method} ${url} ${JSON.stringify(body)}`);
    assert.equal(typeof res.body.error, 'string');
  }
  assert.equal((await json('GET', '/api/miniatures/999999')).status, 404);
  assert.equal((await json('GET', '/api/nope')).status, 404);
});

test('photos: caption, date and stage can be edited; the cover must belong to the miniature; deletes go to trash', async () => {
  const a = (await json('POST', '/api/miniatures', { name: 'Photo A' })).body;
  const b = (await json('POST', '/api/miniatures', { name: 'Photo B' })).body;
  const pa = await upload(a.id);
  const pb = await upload(b.id);

  const edited = await json('PATCH', `/api/photos/${pa.id}`, { caption: 'Base coat', takenAt: '2026-01-02T10:00:00.000Z', stage: 'primed' });
  assert.deepEqual([edited.body.caption, edited.body.takenAt, edited.body.stage], ['Base coat', '2026-01-02T10:00:00.000Z', 'primed']);
  assert.equal((await json('PATCH', `/api/photos/${pa.id}`, { caption: '' })).body.caption, null);

  assert.equal((await json('PUT', `/api/miniatures/${a.id}/cover`, { photoId: pb.id })).status, 400);
  assert.equal((await json('PUT', `/api/miniatures/${a.id}/cover`, { photoId: pa.id })).body.hasExplicitCover, true);
  const cleared = (await json('PUT', `/api/miniatures/${a.id}/cover`, { photoId: null })).body;
  assert.equal(cleared.hasExplicitCover, false);
  assert.equal(cleared.coverPhotoId, pa.id, 'without a chosen cover, the newest photo is used');

  assert.equal((await json('DELETE', `/api/photos/${pa.id}`)).status, 204);
  assert.equal(fs.existsSync(path.join(dataDir, pa.path)), false);
  assert.equal(fs.readdirSync(path.join(dataDir, 'trash')).length, 1);
  assert.equal((await json('GET', `/api/miniatures/${a.id}`)).body.coverPhotoId, null);
});

test('tags: rename, refuse a clash, delete removes them from miniatures', async () => {
  const mini = (await json('POST', '/api/miniatures', { name: 'Tagged', tags: ['Infantry', 'Elite'] })).body;
  const tags = (await json('GET', '/api/tags')).body as { id: number; name: string; miniCount: number }[];
  const infantry = tags.find((t) => t.name === 'Infantry')!;
  assert.equal(infantry.miniCount, 1);
  assert.equal((await json('PATCH', `/api/tags/${infantry.id}`, { name: 'ELITE' })).status, 409);
  assert.equal((await json('PATCH', `/api/tags/${infantry.id}`, { name: 'Troops' })).body.name, 'Troops');
  assert.deepEqual((await json('GET', `/api/miniatures/${mini.id}`)).body.tags, ['Elite', 'Troops']);
  await json('DELETE', `/api/tags/${infantry.id}`);
  assert.deepEqual((await json('GET', `/api/miniatures/${mini.id}`)).body.tags, ['Elite']);
});

test('groups: no self-parenting, no nesting a group that has children, deleting a parent frees its children', async () => {
  const parent = (await json('POST', '/api/groups', { name: 'Parent' })).body;
  const child = (await json('POST', '/api/groups', { name: 'Child', parentId: parent.id })).body;
  const other = (await json('POST', '/api/groups', { name: 'Other' })).body;
  assert.equal((await json('PATCH', `/api/groups/${other.id}`, { parentId: other.id })).status, 400);
  assert.equal((await json('PATCH', `/api/groups/${parent.id}`, { parentId: other.id })).status, 400);
  await json('DELETE', `/api/groups/${parent.id}`);
  assert.equal((await json('GET', `/api/groups/${child.id}`)).body.parentId, null);
});

test('sessions: the duration of a running timer cannot be edited; stopping with no timer is harmless', async () => {
  const started = (await json('POST', '/api/sessions/start', {})).body;
  assert.equal((await json('PATCH', `/api/sessions/${started.id}`, { durationSec: 60 })).status, 409);
  assert.ok((await json('POST', '/api/sessions/stop', {})).body.session);
  assert.equal((await json('POST', '/api/sessions/stop', {})).body.session, null);
});

test('shopping: labels and notes can be edited, and an item can be un-bought', async () => {
  const item = (await json('POST', '/api/shopping', { label: 'Glue' })).body;
  const bought = (await json('PATCH', `/api/shopping/${item.id}`, { bought: true, note: 'Thin one' })).body;
  assert.ok(bought.boughtAt);
  assert.equal(bought.note, 'Thin one');
  assert.equal((await json('PATCH', `/api/shopping/${item.id}`, { bought: false })).body.boughtAt, null);
});

test('recipes: an unknown paint is refused, and a deleted recipe is gone', async () => {
  assert.equal((await json('POST', '/api/recipes', { name: 'R', steps: [{ phase: 'base', paintId: 999999 }] })).status, 400);
  const recipe = (await json('POST', '/api/recipes', { name: 'Library one' })).body;
  assert.equal(recipe.miniatureId, null);
  assert.equal((await json('DELETE', `/api/recipes/${recipe.id}`)).status, 204);
  assert.equal((await json('GET', `/api/recipes/${recipe.id}`)).status, 404);
});

test('the random pick returns nothing when nothing matches', async () => {
  assert.equal((await json('GET', '/api/miniatures/random?tag=does-not-exist')).body.miniature, null);
});

test('settings round-trip any JSON value', async () => {
  await json('PUT', '/api/settings', { 'ui.compact': true, 'ui.favourite': { colour: 'blue' } });
  const settings = (await json('GET', '/api/settings')).body;
  assert.equal(settings['ui.compact'], true);
  assert.deepEqual(settings['ui.favourite'], { colour: 'blue' });
});

test('responses carry basic security headers', async () => {
  const res = await app.inject({ url: '/api/health' });
  assert.equal(res.headers['x-content-type-options'], 'nosniff');
  assert.equal(res.headers['referrer-policy'], 'same-origin');
});
