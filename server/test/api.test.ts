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
  assert.equal(body.schemaVersion, 1);
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
