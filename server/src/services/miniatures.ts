import type { Miniature, MiniatureSummary, Status } from '@minibald/shared';
import type { Db } from '../db/connection.ts';
import { now } from '../lib/http.ts';
import { miniDir, toPhoto, type PhotoRow } from './photos.ts';

export interface MiniRow {
  id: number;
  group_id: number | null;
  name: string;
  slug: string;
  description: string | null;
  notes: string | null;
  status: Status;
  quantity: number;
  cover_photo_id: number | null;
  acquired_on: string | null;
  started_at: string | null;
  finished_at: string | null;
  created_at: string;
  updated_at: string;
  group_name: string | null;
  group_slug: string | null;
  group_color: string | null;
  cover_id: number | null;
  photo_count: number;
}

export const MINI_SELECT = `
  SELECT m.*, g.name AS group_name, g.slug AS group_slug, g.color AS group_color,
    COALESCE(m.cover_photo_id,
      (SELECT id FROM photos WHERE miniature_id = m.id ORDER BY taken_at DESC, id DESC LIMIT 1)) AS cover_id,
    (SELECT COUNT(*) FROM photos WHERE miniature_id = m.id) AS photo_count
  FROM miniatures m LEFT JOIN groups g ON g.id = m.group_id`;

export function hydrate(db: Db, rows: MiniRow[]): MiniatureSummary[] {
  const tags = new Map<number, string[]>();
  if (rows.length > 0) {
    const tagRows = db
      .prepare(
        `SELECT mt.miniature_id AS id, t.name FROM miniature_tags mt JOIN tags t ON t.id = mt.tag_id
         WHERE mt.miniature_id IN (${rows.map(() => '?').join(',')}) ORDER BY t.name COLLATE NOCASE`,
      )
      .all(...rows.map((r) => r.id)) as { id: number; name: string }[];
    for (const t of tagRows) tags.set(t.id, [...(tags.get(t.id) ?? []), t.name]);
  }
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    slug: r.slug,
    group: r.group_id ? { id: r.group_id, name: r.group_name!, color: r.group_color } : null,
    description: r.description,
    notes: r.notes,
    status: r.status,
    quantity: r.quantity,
    coverPhotoId: r.cover_id,
    photoCount: r.photo_count,
    tags: tags.get(r.id) ?? [],
    acquiredOn: r.acquired_on,
    startedAt: r.started_at,
    finishedAt: r.finished_at,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }));
}

export const getMiniRow = (db: Db, id: number) =>
  db.prepare(`${MINI_SELECT} WHERE m.id = ?`).get(id) as MiniRow | undefined;

export const rowDir = (r: Pick<MiniRow, 'group_slug' | 'slug' | 'id'>) => miniDir(r.group_slug, r.slug, r.id);

export function getMiniature(db: Db, id: number): Miniature | undefined {
  const row = getMiniRow(db, id);
  if (!row) return undefined;
  const photos = db
    .prepare('SELECT * FROM photos WHERE miniature_id = ? ORDER BY taken_at DESC, id DESC')
    .all(id) as PhotoRow[];
  return {
    ...hydrate(db, [row])[0]!,
    folder: rowDir(row),
    hasExplicitCover: row.cover_photo_id !== null,
    paintedSeconds: db
      .prepare('SELECT COALESCE(SUM(duration_sec), 0) FROM painting_sessions WHERE miniature_id = ?')
      .pluck()
      .get(id) as number,
    photos: photos.map(toPhoto),
  };
}

export function setTags(db: Db, miniatureId: number, names: string[]) {
  // Case-insensitive de-duplication; the first spelling wins.
  const seen = new Set<string>();
  const unique = names.filter((n) => !seen.has(n.toLowerCase()) && seen.add(n.toLowerCase()));
  db.prepare('DELETE FROM miniature_tags WHERE miniature_id = ?').run(miniatureId);
  const insertTag = db.prepare('INSERT OR IGNORE INTO tags (name) VALUES (?)');
  const link = db.prepare(
    'INSERT INTO miniature_tags (miniature_id, tag_id) SELECT ?, id FROM tags WHERE name = ? COLLATE NOCASE',
  );
  for (const name of unique) {
    insertTag.run(name);
    link.run(miniatureId, name);
  }
  db.prepare('DELETE FROM tags WHERE id NOT IN (SELECT tag_id FROM miniature_tags)').run();
}

/** Single place where status changes: keeps the history and the started/finished dates in step. */
export function applyStatus(db: Db, id: number, from: Status | null, to: Status) {
  if (from === to) return;
  const ts = now();
  db.prepare(
    `UPDATE miniatures SET status = @to, updated_at = @ts,
       started_at  = CASE WHEN @to = 'in_progress' THEN COALESCE(started_at, @ts) ELSE started_at END,
       finished_at = CASE WHEN @to = 'finished' THEN @ts ELSE NULL END
     WHERE id = @id`,
  ).run({ id, to, ts });
  db.prepare('INSERT INTO status_events (miniature_id, from_status, to_status, changed_at) VALUES (?, ?, ?, ?)').run(
    id,
    from,
    to,
    ts,
  );
}

export const touch = (db: Db, id: number) =>
  db.prepare('UPDATE miniatures SET updated_at = ? WHERE id = ?').run(now(), id);
