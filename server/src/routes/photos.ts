import fs from 'node:fs';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { coverSchema, photoPatchSchema } from '@minibald/shared';
import type { Ctx } from '../app.ts';
import { HttpError, notFound, parseId } from '../lib/http.ts';
import { getMiniRow, getMiniature, rowDir, touch } from '../services/miniatures.ts';
import { THUMB_WIDTHS, dropThumbs, ensureThumb, moveToTrash, savePhoto, toPhoto, type PhotoRow } from '../services/photos.ts';

const MIME: Record<string, string> = { '.jpg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' };
// Photo ids are never reused and files never change, so the browser may cache forever.
const IMMUTABLE = 'public, max-age=31536000, immutable';

export function photoRoutes(app: FastifyInstance, { db, config }: Ctx) {
  const getPhoto = (id: number) => db.prepare('SELECT * FROM photos WHERE id = ?').get(id) as PhotoRow | undefined;

  app.post('/miniatures/:id/photos', async (req, reply) => {
    const id = parseId((req.params as { id: string }).id);
    const mini = getMiniRow(db, id);
    if (!mini) throw notFound('Miniature');
    const takenAtRaw = (req.query as { takenAt?: string }).takenAt;
    const takenAt = takenAtRaw && !Number.isNaN(Date.parse(takenAtRaw)) ? new Date(takenAtRaw).toISOString() : undefined;

    const saved: PhotoRow[] = [];
    for await (const part of req.files()) {
      const buffer = await part.toBuffer();
      saved.push(await savePhoto(db, config.dataDir, { miniatureId: id, dir: rowDir(mini), stage: mini.status, buffer, takenAt }));
    }
    if (saved.length === 0) throw new HttpError(400, 'No file received');
    touch(db, id);
    reply.code(201);
    return saved.map(toPhoto);
  });

  app.patch('/photos/:id', (req) => {
    const id = parseId((req.params as { id: string }).id);
    const input = photoPatchSchema.parse(req.body);
    const current = getPhoto(id);
    if (!current) throw notFound('Photo');
    db.prepare('UPDATE photos SET caption = ?, taken_at = ?, stage = ? WHERE id = ?').run(
      input.caption === undefined ? current.caption : input.caption,
      input.takenAt ?? current.taken_at,
      input.stage === undefined ? current.stage : input.stage,
      id,
    );
    return toPhoto(getPhoto(id)!);
  });

  app.delete('/photos/:id', (req, reply) => {
    const id = parseId((req.params as { id: string }).id);
    const current = getPhoto(id);
    if (!current) throw notFound('Photo');
    db.prepare('DELETE FROM photos WHERE id = ?').run(id);
    moveToTrash(config.dataDir, current.path);
    dropThumbs(config.dataDir, id);
    touch(db, current.miniature_id);
    return reply.code(204).send();
  });

  app.put('/miniatures/:id/cover', (req) => {
    const id = parseId((req.params as { id: string }).id);
    const { photoId } = coverSchema.parse(req.body);
    if (!getMiniRow(db, id)) throw notFound('Miniature');
    if (photoId !== null && getPhoto(photoId)?.miniature_id !== id) {
      throw new HttpError(400, 'Photo does not belong to this miniature');
    }
    db.prepare('UPDATE miniatures SET cover_photo_id = ? WHERE id = ?').run(photoId, id);
    return getMiniature(db, id);
  });

  // Media is addressed by photo id, never by path, so nothing outside the database is reachable.
  app.get('/media/photos/:id', (req, reply) => {
    const photo = getPhoto(parseId((req.params as { id: string }).id));
    const file = photo && path.join(config.dataDir, photo.path);
    if (!file || !fs.existsSync(file)) throw notFound('Photo');
    return reply
      .header('Cache-Control', IMMUTABLE)
      .type(MIME[path.extname(file)] ?? 'application/octet-stream')
      .send(fs.createReadStream(file));
  });

  app.get('/media/thumbs/:id', async (req, reply) => {
    const photo = getPhoto(parseId((req.params as { id: string }).id));
    if (!photo || !fs.existsSync(path.join(config.dataDir, photo.path))) throw notFound('Photo');
    const asked = Number((req.query as { w?: string }).w) || 400;
    const width = THUMB_WIDTHS.find((w) => w >= asked) ?? THUMB_WIDTHS.at(-1)!;
    const file = await ensureThumb(config.dataDir, photo, width);
    return reply.header('Cache-Control', IMMUTABLE).type('image/webp').send(fs.createReadStream(file));
  });
}
