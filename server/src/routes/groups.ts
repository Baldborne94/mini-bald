import type { FastifyInstance } from 'fastify';
import { emptyCounts, groupInputSchema, groupPatchSchema, type Group, type Status } from '@minibald/shared';
import type { Ctx } from '../app.ts';
import type { Db } from '../db/connection.ts';
import { HttpError, notFound, now, parseId } from '../lib/http.ts';
import { slugify } from '../lib/slug.ts';
import { groupDir, miniDir, relocate } from '../services/photos.ts';

interface GroupRow {
  id: number;
  parent_id: number | null;
  name: string;
  slug: string;
  kind: string | null;
  description: string | null;
  color: string | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
  mini_count: number;
}

const SELECT = `SELECT g.*, (SELECT COUNT(*) FROM miniatures WHERE group_id = g.id) AS mini_count FROM groups g`;

function listGroups(db: Db, id?: number): Group[] {
  const rows = (
    id === undefined
      ? db.prepare(`${SELECT} ORDER BY g.sort_order, g.name COLLATE NOCASE`).all()
      : db.prepare(`${SELECT} WHERE g.id = ?`).all(id)
  ) as GroupRow[];
  const counts = db
    .prepare(
      'SELECT group_id, status, SUM(quantity) AS models FROM miniatures WHERE group_id IS NOT NULL GROUP BY group_id, status',
    )
    .all() as { group_id: number; status: Status; models: number }[];
  const byGroup = new Map<number, Group['counts']>();
  for (const c of counts) {
    const entry = byGroup.get(c.group_id) ?? emptyCounts();
    entry[c.status] = c.models;
    byGroup.set(c.group_id, entry);
  }
  return rows.map((r) => ({
    id: r.id,
    parentId: r.parent_id,
    name: r.name,
    slug: r.slug,
    kind: r.kind,
    description: r.description,
    color: r.color,
    sortOrder: r.sort_order,
    miniCount: r.mini_count,
    counts: byGroup.get(r.id) ?? emptyCounts(),
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }));
}

function uniqueSlug(db: Db, name: string, exceptId: number | null): string {
  const base = slugify(name, 'group');
  const taken = db.prepare('SELECT 1 FROM groups WHERE slug = ? AND id IS NOT ?');
  let slug = base;
  for (let i = 2; taken.get(slug, exceptId); i++) slug = `${base}-${i}`;
  return slug;
}

/** Groups nest one level only: a parent must be top-level, and a group with children cannot be nested. */
function checkParent(db: Db, parentId: number | null | undefined, selfId: number | null) {
  if (parentId == null) return;
  if (parentId === selfId) throw new HttpError(400, 'A group cannot be its own parent');
  const parent = db.prepare('SELECT parent_id FROM groups WHERE id = ?').get(parentId) as
    | { parent_id: number | null }
    | undefined;
  if (!parent) throw new HttpError(400, 'Parent group does not exist');
  if (parent.parent_id !== null) throw new HttpError(400, 'Groups can only be nested one level deep');
  if (selfId !== null && db.prepare('SELECT 1 FROM groups WHERE parent_id = ?').get(selfId)) {
    throw new HttpError(400, 'A group that has sub-groups cannot be nested');
  }
}

export function groupRoutes(app: FastifyInstance, { db, config }: Ctx) {
  app.get('/groups', () => listGroups(db));

  app.get('/groups/:id', (req) => {
    const group = listGroups(db, parseId((req.params as { id: string }).id))[0];
    if (!group) throw notFound('Group');
    return group;
  });

  app.post('/groups', (req, reply) => {
    const input = groupInputSchema.parse(req.body);
    checkParent(db, input.parentId, null);
    const ts = now();
    const { lastInsertRowid } = db
      .prepare(
        `INSERT INTO groups (parent_id, name, slug, kind, description, color, sort_order, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.parentId ?? null,
        input.name,
        uniqueSlug(db, input.name, null),
        input.kind ?? null,
        input.description ?? null,
        input.color ?? null,
        input.sortOrder ?? 0,
        ts,
        ts,
      );
    reply.code(201);
    return listGroups(db, Number(lastInsertRowid))[0];
  });

  app.patch('/groups/:id', (req) => {
    const id = parseId((req.params as { id: string }).id);
    const input = groupPatchSchema.parse(req.body);
    const current = db.prepare('SELECT * FROM groups WHERE id = ?').get(id) as GroupRow | undefined;
    if (!current) throw notFound('Group');
    if (input.parentId !== undefined) checkParent(db, input.parentId, id);

    const name = input.name ?? current.name;
    const slug = name === current.name ? current.slug : uniqueSlug(db, name, id);
    relocate(db, config.dataDir, groupDir(current.slug), groupDir(slug), () =>
      db
        .prepare(
          `UPDATE groups SET name = ?, slug = ?, parent_id = ?, kind = ?, description = ?, color = ?,
             sort_order = ?, updated_at = ? WHERE id = ?`,
        )
        .run(
          name,
          slug,
          input.parentId === undefined ? current.parent_id : input.parentId,
          input.kind === undefined ? current.kind : input.kind,
          input.description === undefined ? current.description : input.description,
          input.color === undefined ? current.color : input.color,
          input.sortOrder ?? current.sort_order,
          now(),
          id,
        ),
    );
    return listGroups(db, id)[0];
  });

  // Deleting a group never deletes miniatures: they become ungrouped and their folders follow.
  app.delete('/groups/:id', (req, reply) => {
    const id = parseId((req.params as { id: string }).id);
    const current = db.prepare('SELECT slug FROM groups WHERE id = ?').get(id) as { slug: string } | undefined;
    if (!current) throw notFound('Group');
    const minis = db.prepare('SELECT id, slug FROM miniatures WHERE group_id = ?').all(id) as {
      id: number;
      slug: string;
    }[];
    for (const m of minis) {
      relocate(db, config.dataDir, miniDir(current.slug, m.slug, m.id), miniDir(null, m.slug, m.id), () =>
        db.prepare('UPDATE miniatures SET group_id = NULL, updated_at = ? WHERE id = ?').run(now(), m.id),
      );
    }
    db.prepare('DELETE FROM groups WHERE id = ?').run(id);
    return reply.code(204).send();
  });
}
