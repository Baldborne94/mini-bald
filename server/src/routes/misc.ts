import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { emptyCounts, tagPatchSchema, type Dashboard, type Health, type Status, type Tag } from '@minibald/shared';
import type { Ctx } from '../app.ts';
import { schemaVersion } from '../db/migrate.ts';
import { HttpError, notFound, parseId } from '../lib/http.ts';
import { MINI_SELECT, hydrate, type MiniRow } from '../services/miniatures.ts';
import { toPhoto, type PhotoRow } from '../services/photos.ts';

const VERSION = '0.1.0';

export function miscRoutes(app: FastifyInstance, { db, ai }: Ctx) {
  app.get('/health', (): Health => ({
    ok: true,
    version: VERSION,
    schemaVersion: schemaVersion(db),
    aiConfigured: ai !== null,
  }));

  // ---- Settings: a small JSON key/value store ----
  app.get('/settings', () => {
    const rows = db.prepare('SELECT key, value FROM settings').all() as { key: string; value: string }[];
    return Object.fromEntries(rows.map((r) => [r.key, JSON.parse(r.value)]));
  });

  app.put('/settings', (req) => {
    const input = z.record(z.string().max(80), z.unknown()).parse(req.body);
    const upsert = db.prepare(
      'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    );
    db.transaction(() => {
      for (const [key, value] of Object.entries(input)) upsert.run(key, JSON.stringify(value ?? null));
    })();
    return { ok: true };
  });

  // ---- Tags (created implicitly by assigning them to a miniature) ----
  const listTags = () =>
    db
      .prepare(
        `SELECT t.id, t.name, t.color, COUNT(mt.miniature_id) AS miniCount
         FROM tags t LEFT JOIN miniature_tags mt ON mt.tag_id = t.id
         GROUP BY t.id ORDER BY t.name COLLATE NOCASE`,
      )
      .all() as Tag[];

  app.get('/tags', listTags);

  app.patch('/tags/:id', (req) => {
    const id = parseId((req.params as { id: string }).id);
    const input = tagPatchSchema.parse(req.body);
    const current = db.prepare('SELECT * FROM tags WHERE id = ?').get(id) as { name: string; color: string | null } | undefined;
    if (!current) throw notFound('Tag');
    if (input.name && db.prepare('SELECT 1 FROM tags WHERE name = ? COLLATE NOCASE AND id != ?').get(input.name, id)) {
      throw new HttpError(409, 'A tag with this name already exists');
    }
    db.prepare('UPDATE tags SET name = ?, color = ? WHERE id = ?').run(
      input.name ?? current.name,
      input.color === undefined ? current.color : input.color,
      id,
    );
    return listTags().find((t) => t.id === id);
  });

  app.delete('/tags/:id', (req, reply) => {
    db.prepare('DELETE FROM tags WHERE id = ?').run(parseId((req.params as { id: string }).id));
    return reply.code(204).send();
  });

  // ---- Dashboard ----
  app.get('/dashboard', (): Dashboard => {
    const models = emptyCounts();
    const statusRows = db
      .prepare('SELECT status, SUM(quantity) AS models, COUNT(*) AS cards FROM miniatures GROUP BY status')
      .all() as { status: Status; models: number; cards: number }[];
    let cards = 0;
    for (const r of statusRows) {
      models[r.status] = r.models;
      cards += r.cards;
    }
    const totalModels = Object.values(models).reduce((a, b) => a + b, 0);

    // "This month" follows the server's local time zone (TZ).
    const today = new Date();
    const monthStart = new Date(today.getFullYear(), today.getMonth(), 1).toISOString();
    const finishedThisMonth = db
      .prepare(`SELECT COALESCE(SUM(quantity), 0) FROM miniatures WHERE status = 'finished' AND finished_at >= ?`)
      .pluck()
      .get(monthStart) as number;

    const painted = db
      .prepare(
        `SELECT COALESCE(SUM(duration_sec), 0) AS total,
                COALESCE(SUM(CASE WHEN started_at >= ? THEN duration_sec END), 0) AS month
         FROM painting_sessions`,
      )
      .get(monthStart) as { total: number; month: number };

    const inProgress = db
      .prepare(`${MINI_SELECT} WHERE m.status = 'in_progress' ORDER BY m.updated_at DESC LIMIT 12`)
      .all() as MiniRow[];
    // Prefer something already on the bench; otherwise the most recently touched unfinished card.
    const continueWith =
      inProgress[0] ??
      (db.prepare(`${MINI_SELECT} WHERE m.status != 'finished' ORDER BY m.updated_at DESC LIMIT 1`).get() as
        | MiniRow
        | undefined);

    const groupRows = db
      .prepare(
        `SELECT g.id, g.name, g.color, m.status, SUM(m.quantity) AS models
         FROM miniatures m LEFT JOIN groups g ON g.id = COALESCE(
           (SELECT parent_id FROM groups WHERE id = m.group_id), m.group_id)
         GROUP BY g.id, m.status`,
      )
      .all() as { id: number | null; name: string | null; color: string | null; status: Status; models: number }[];
    const groups = new Map<number | null, Dashboard['groups'][number]>();
    for (const r of groupRows) {
      const entry = groups.get(r.id) ?? { id: r.id, name: r.name ?? 'Ungrouped', color: r.color, counts: emptyCounts() };
      entry.counts[r.status] = r.models;
      groups.set(r.id, entry);
    }

    const recentPhotos = db
      .prepare(
        `SELECT p.*, m.name AS miniature_name FROM photos p JOIN miniatures m ON m.id = p.miniature_id
         ORDER BY p.taken_at DESC, p.id DESC LIMIT 12`,
      )
      .all() as (PhotoRow & { miniature_name: string })[];

    return {
      models,
      cards,
      totalModels,
      pile: totalModels - models.finished,
      finishedThisMonth,
      paintedSecondsThisMonth: painted.month,
      paintedSecondsTotal: painted.total,
      continueWith: continueWith ? hydrate(db, [continueWith])[0]! : null,
      inProgress: hydrate(db, inProgress),
      groups: [...groups.values()].sort((a, b) => (a.id === null ? 1 : b.id === null ? -1 : a.name.localeCompare(b.name))),
      recentPhotos: recentPhotos.map((p) => ({ ...toPhoto(p), miniatureName: p.miniature_name })),
    };
  });
}
