import fs from 'node:fs';
import path from 'node:path';
import sharp, { type Metadata } from 'sharp';
import type { Photo, Status } from '@minibald/shared';
import type { Db } from '../db/connection.ts';
import { HttpError, now } from '../lib/http.ts';

export const UNGROUPED_DIR = '_ungrouped';
export const THUMB_WIDTHS = [200, 400, 800, 1600] as const;
const EXT: Record<string, string> = { jpeg: 'jpg', png: 'png', webp: 'webp' };

export interface PhotoRow {
  id: number;
  miniature_id: number;
  path: string;
  width: number | null;
  height: number | null;
  bytes: number | null;
  stage: Status | null;
  caption: string | null;
  taken_at: string;
  created_at: string;
}

export const toPhoto = (r: PhotoRow): Photo => ({
  id: r.id,
  miniatureId: r.miniature_id,
  path: r.path,
  width: r.width,
  height: r.height,
  bytes: r.bytes,
  stage: r.stage,
  caption: r.caption,
  takenAt: r.taken_at,
  createdAt: r.created_at,
});

export const groupDir = (groupSlug: string | null) => path.posix.join('photos', groupSlug ?? UNGROUPED_DIR);
export const miniDir = (groupSlug: string | null, miniSlug: string, id: number) =>
  path.posix.join(groupDir(groupSlug), `${miniSlug}-${id}`);

const pad = (n: number) => String(n).padStart(2, '0');
/** Local-time stamp (honours TZ) used in readable file names. */
export function fileStamp(d = new Date()): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

function freePath(dataDir: string, dir: string, base: string, ext: string): string {
  let rel = path.posix.join(dir, `${base}.${ext}`);
  for (let i = 2; fs.existsSync(path.join(dataDir, rel)); i++) rel = path.posix.join(dir, `${base}-${i}.${ext}`);
  return rel;
}

export async function savePhoto(
  db: Db,
  dataDir: string,
  opts: { miniatureId: number; dir: string; stage: Status; buffer: Buffer; takenAt?: string },
): Promise<PhotoRow> {
  let meta: Metadata;
  try {
    meta = await sharp(opts.buffer).metadata();
  } catch {
    throw new HttpError(415, 'File is not a readable image');
  }
  const ext = EXT[meta.format ?? ''];
  if (!ext) throw new HttpError(415, 'Only JPEG, PNG and WebP images are supported');

  const takenAt = opts.takenAt ?? now();
  // EXIF orientations 5-8 swap the displayed width/height.
  const rotated = (meta.orientation ?? 1) >= 5;
  const width = (rotated ? meta.height : meta.width) ?? null;
  const height = (rotated ? meta.width : meta.height) ?? null;

  fs.mkdirSync(path.join(dataDir, opts.dir), { recursive: true });
  const rel = freePath(dataDir, opts.dir, `${fileStamp(new Date(takenAt))}_${opts.stage}`, ext);
  fs.writeFileSync(path.join(dataDir, rel), opts.buffer);
  try {
    return db
      .prepare(
        `INSERT INTO photos (miniature_id, path, width, height, bytes, stage, taken_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING *`,
      )
      .get(opts.miniatureId, rel, width, height, opts.buffer.length, opts.stage, takenAt, now()) as PhotoRow;
  } catch (err) {
    fs.rmSync(path.join(dataDir, rel), { force: true });
    throw err;
  }
}

const thumbPath = (dataDir: string, id: number, w: number) =>
  path.join(dataDir, 'cache/thumbs', `${id}_${w}.webp`);

export async function ensureThumb(dataDir: string, photo: PhotoRow, width: number): Promise<string> {
  const out = thumbPath(dataDir, photo.id, width);
  if (!fs.existsSync(out)) {
    const tmp = `${out}.${process.pid}.tmp`;
    await sharp(path.join(dataDir, photo.path))
      .rotate()
      .resize({ width, withoutEnlargement: true })
      .webp({ quality: 78 })
      .toFile(tmp);
    fs.renameSync(tmp, out);
  }
  return out;
}

export function dropThumbs(dataDir: string, photoId: number) {
  for (const w of THUMB_WIDTHS) fs.rmSync(thumbPath(dataDir, photoId, w), { force: true });
}

/** Nothing is ever hard-deleted: files go to data/trash, keeping their readable names. */
export function moveToTrash(dataDir: string, rel: string) {
  const src = path.join(dataDir, rel);
  if (!fs.existsSync(src)) return;
  const dest = path.join(dataDir, 'trash', `${fileStamp()}_${rel.replace(/^photos\//, '').replaceAll('/', '__')}`);
  fs.renameSync(src, dest);
}

function removeIfEmpty(dir: string) {
  try {
    fs.rmdirSync(dir);
  } catch {
    /* not empty or missing: fine */
  }
}

/**
 * Renames a photo folder and rewrites the stored paths, keeping disk and database in step:
 * the folder moves first, the paths are updated inside `mutate`'s transaction, and the
 * folder is moved back if that transaction fails.
 */
export function relocate<T>(db: Db, dataDir: string, from: string, to: string, mutate: () => T): T {
  if (from === to) return db.transaction(mutate)();
  const src = path.join(dataDir, from);
  const dest = path.join(dataDir, to);
  const moved = fs.existsSync(src);
  if (moved) {
    if (fs.existsSync(dest)) throw new HttpError(409, `Folder already exists: ${to}`);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.renameSync(src, dest);
  }
  try {
    const result = db.transaction(() => {
      const out = mutate();
      const prefix = `${from}/`;
      db.prepare('UPDATE photos SET path = ? || substr(path, ?) WHERE substr(path, 1, ?) = ?').run(
        `${to}/`,
        prefix.length + 1,
        prefix.length,
        prefix,
      );
      return out;
    })();
    if (moved) removeIfEmpty(path.dirname(src));
    return result;
  } catch (err) {
    if (moved) fs.renameSync(dest, src);
    throw err;
  }
}
