import type { FastifyInstance } from 'fastify';
import {
  STATUSES,
  miniatureCreateSchema,
  miniaturePatchSchema,
  statusChangeSchema,
  type MiniatureList,
  type Status,
  type StatusChangeResult,
} from '@minibald/shared';
import type { Ctx } from '../app.ts';
import type { Db } from '../db/connection.ts';
import { HttpError, notFound, now, parseId } from '../lib/http.ts';
import { slugify } from '../lib/slug.ts';
import { MINI_SELECT, applyStatus, getMiniRow, getMiniature, hydrate, rowDir, setTags, type MiniRow } from '../services/miniatures.ts';
import { dropThumbs, miniDir, moveToTrash, relocate } from '../services/photos.ts';

interface ListQuery {
  q?: string;
  status?: string;
  group?: string;
  tag?: string;
  sort?: string;
  limit?: string;
  offset?: string;
}

const SORTS: Record<string, string> = {
  updated: 'm.updated_at DESC',
  created: 'm.created_at DESC',
  name: 'm.name COLLATE NOCASE ASC',
  status: `CASE m.status ${STATUSES.map((s, i) => `WHEN '${s}' THEN ${i}`).join(' ')} END, m.name COLLATE NOCASE`,
};

const csv = (v?: string) => (v ? v.split(',').map((s) => s.trim()).filter(Boolean) : []);

/** Builds the WHERE clause shared by the list and the random pick. */
function filters(query: ListQuery) {
  const where: string[] = [];
  const params: unknown[] = [];

  const q = query.q?.trim();
  if (q) {
    const like = `%${q.replace(/[\\%_]/g, '\\$&')}%`;
    where.push(`(m.name LIKE ? ESCAPE '\\' OR m.description LIKE ? ESCAPE '\\' OR m.notes LIKE ? ESCAPE '\\'
      OR EXISTS (SELECT 1 FROM miniature_tags mt JOIN tags t ON t.id = mt.tag_id
                 WHERE mt.miniature_id = m.id AND t.name LIKE ? ESCAPE '\\'))`);
    params.push(like, like, like, like);
  }

  const statuses = csv(query.status).filter((s): s is Status => (STATUSES as readonly string[]).includes(s));
  if (statuses.length > 0) {
    where.push(`m.status IN (${statuses.map(() => '?').join(',')})`);
    params.push(...statuses);
  }

  if (query.group === 'none') {
    where.push('m.group_id IS NULL');
  } else if (query.group) {
    // A parent group also shows what is filed under its sub-groups.
    const id = parseId(query.group);
    where.push('m.group_id IN (SELECT id FROM groups WHERE id = ? OR parent_id = ?)');
    params.push(id, id);
  }

  for (const tag of csv(query.tag)) {
    where.push(`EXISTS (SELECT 1 FROM miniature_tags mt JOIN tags t ON t.id = mt.tag_id
                        WHERE mt.miniature_id = m.id AND t.name = ? COLLATE NOCASE)`);
    params.push(tag);
  }

  return { sql: where.length > 0 ? `WHERE ${where.join(' AND ')}` : '', params };
}

function groupSlug(db: Db, groupId: number | null | undefined): string | null {
  if (groupId == null) return null;
  const row = db.prepare('SELECT slug FROM groups WHERE id = ?').get(groupId) as { slug: string } | undefined;
  if (!row) throw new HttpError(400, 'Group does not exist');
  return row.slug;
}

export function miniatureRoutes(app: FastifyInstance, { db, config }: Ctx) {
  app.get('/miniatures', (req): MiniatureList => {
    const query = req.query as ListQuery;
    const { sql, params } = filters(query);
    const limit = Math.min(Math.max(Number(query.limit) || 500, 1), 1000);
    const offset = Math.max(Number(query.offset) || 0, 0);
    const order = SORTS[query.sort ?? ''] ?? SORTS.updated!;
    const rows = db
      .prepare(`${MINI_SELECT} ${sql} ORDER BY ${order}, m.id DESC LIMIT ? OFFSET ?`)
      .all(...params, limit, offset) as MiniRow[];
    const total = db.prepare(`SELECT COUNT(*) FROM miniatures m ${sql}`).pluck().get(...params) as number;
    return { items: hydrate(db, rows), total };
  });

  // Registered before /:id so "random" is not parsed as an id.
  app.get('/miniatures/random', (req) => {
    const query = req.query as ListQuery;
    const { sql, params } = filters({ ...query, status: query.status ?? STATUSES.filter((s) => s !== 'finished').join(',') });
    const row = db.prepare(`${MINI_SELECT} ${sql} ORDER BY RANDOM() LIMIT 1`).get(...params) as MiniRow | undefined;
    return { miniature: row ? hydrate(db, [row])[0] : null };
  });

  app.get('/miniatures/:id', (req) => {
    const mini = getMiniature(db, parseId((req.params as { id: string }).id));
    if (!mini) throw notFound('Miniature');
    return mini;
  });

  app.post('/miniatures', (req, reply) => {
    const input = miniatureCreateSchema.parse(req.body);
    groupSlug(db, input.groupId);
    const id = db.transaction(() => {
      const ts = now();
      const { lastInsertRowid } = db
        .prepare(
          `INSERT INTO miniatures (group_id, name, slug, description, notes, quantity, acquired_on, started_at, finished_at, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          input.groupId ?? null,
          input.name,
          slugify(input.name, 'miniature'),
          input.description ?? null,
          input.notes ?? null,
          input.quantity ?? 1,
          input.acquiredOn ?? null,
          input.startedAt ?? null,
          input.finishedAt ?? null,
          ts,
          ts,
        );
      const newId = Number(lastInsertRowid);
      // The row is born 'unassembled'; record where it actually starts as the first history entry.
      const status = input.status ?? 'unassembled';
      db.prepare('UPDATE miniatures SET status = ? WHERE id = ?').run(status, newId);
      db.prepare('INSERT INTO status_events (miniature_id, from_status, to_status, changed_at) VALUES (?, NULL, ?, ?)').run(
        newId,
        status,
        ts,
      );
      if (status === 'in_progress' && !input.startedAt) {
        db.prepare('UPDATE miniatures SET started_at = ? WHERE id = ?').run(ts, newId);
      }
      if (status === 'finished' && !input.finishedAt) {
        db.prepare('UPDATE miniatures SET finished_at = ? WHERE id = ?').run(ts, newId);
      }
      if (input.tags) setTags(db, newId, input.tags);
      return newId;
    })();
    reply.code(201);
    return getMiniature(db, id);
  });

  app.patch('/miniatures/:id', (req) => {
    const id = parseId((req.params as { id: string }).id);
    const input = miniaturePatchSchema.parse(req.body);
    const current = getMiniRow(db, id);
    if (!current) throw notFound('Miniature');

    const name = input.name ?? current.name;
    const slug = slugify(name, 'miniature');
    const groupId = input.groupId === undefined ? current.group_id : input.groupId;
    const newDir = miniDir(groupId === current.group_id ? current.group_slug : groupSlug(db, groupId), slug, id);

    relocate(db, config.dataDir, rowDir(current), newDir, () => {
      db.prepare(
        `UPDATE miniatures SET name = ?, slug = ?, group_id = ?, description = ?, notes = ?, quantity = ?,
           acquired_on = ?, started_at = ?, finished_at = ?, updated_at = ? WHERE id = ?`,
      ).run(
        name,
        slug,
        groupId,
        input.description === undefined ? current.description : input.description,
        input.notes === undefined ? current.notes : input.notes,
        input.quantity ?? current.quantity,
        input.acquiredOn === undefined ? current.acquired_on : input.acquiredOn,
        input.startedAt === undefined ? current.started_at : input.startedAt,
        input.finishedAt === undefined ? current.finished_at : input.finishedAt,
        now(),
        id,
      );
      if (input.tags) setTags(db, id, input.tags);
    });
    return getMiniature(db, id);
  });

  // Separate from PATCH because it has side effects: history now, achievements from Phase 4.
  app.post('/miniatures/:id/status', (req): StatusChangeResult => {
    const id = parseId((req.params as { id: string }).id);
    const { status } = statusChangeSchema.parse(req.body);
    const current = getMiniRow(db, id);
    if (!current) throw notFound('Miniature');
    db.transaction(() => applyStatus(db, id, current.status, status))();
    return { miniature: getMiniature(db, id)!, unlocked: [] };
  });

  app.delete('/miniatures/:id', (req, reply) => {
    const id = parseId((req.params as { id: string }).id);
    const current = getMiniRow(db, id);
    if (!current) throw notFound('Miniature');
    const photoIds = db.prepare('SELECT id FROM photos WHERE miniature_id = ?').pluck().all(id) as number[];
    db.prepare('DELETE FROM miniatures WHERE id = ?').run(id);
    db.prepare('DELETE FROM tags WHERE id NOT IN (SELECT tag_id FROM miniature_tags)').run();
    moveToTrash(config.dataDir, rowDir(current));
    for (const photoId of photoIds) dropThumbs(config.dataDir, photoId);
    return reply.code(204).send();
  });
}
