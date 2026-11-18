import type { FastifyInstance } from 'fastify';
import {
  PAINT_STOCKS,
  paintBulkSchema,
  paintInputSchema,
  paintPatchSchema,
  shoppingInputSchema,
  shoppingPatchSchema,
  type CatalogEntry,
  type Paint,
  type PaintBulkResult,
  type PaintRef,
  type PaintStock,
  type ShoppingItem,
} from '@minibald/shared';
import type { Ctx } from '../app.ts';
import type { Db } from '../db/connection.ts';
import { HttpError, notFound, now, parseId } from '../lib/http.ts';
import { loadCatalog } from '../services/catalog.ts';

interface PaintRow {
  id: number;
  brand: string;
  range: string;
  name: string;
  type: string | null;
  color_hex: string | null;
  stock: PaintStock;
  notes: string | null;
  created_at: string;
  updated_at: string;
  on_list: number;
  used_in_steps: number;
}

const SELECT = `
  SELECT p.*,
    EXISTS (SELECT 1 FROM shopping_items s WHERE s.paint_id = p.id AND s.bought_at IS NULL) AS on_list,
    (SELECT COUNT(*) FROM recipe_steps rs WHERE rs.paint_id = p.id) AS used_in_steps
  FROM paints p`;

const toPaint = (r: PaintRow): Paint => ({
  id: r.id,
  brand: r.brand,
  range: r.range,
  name: r.name,
  type: r.type,
  colorHex: r.color_hex,
  stock: r.stock,
  notes: r.notes,
  onShoppingList: r.on_list === 1,
  usedInSteps: r.used_in_steps,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

const getPaint = (db: Db, id: number) => {
  const row = db.prepare(`${SELECT} WHERE p.id = ?`).get(id) as PaintRow | undefined;
  return row && toPaint(row);
};

/** A paint has at most one open shopping entry. */
function ensureOnList(db: Db, paintId: number): number {
  const open = db.prepare('SELECT id FROM shopping_items WHERE paint_id = ? AND bought_at IS NULL').pluck().get(paintId) as
    | number
    | undefined;
  if (open) return open;
  return Number(db.prepare('INSERT INTO shopping_items (paint_id, created_at) VALUES (?, ?)').run(paintId, now()).lastInsertRowid);
}

/**
 * Inventory and shopping list stay in step: a paint that is low, empty or wished for
 * goes on the list by itself, and one that is back in stock leaves it.
 */
function syncList(db: Db, paintId: number, stock: PaintStock) {
  if (stock === 'owned') db.prepare('DELETE FROM shopping_items WHERE paint_id = ? AND bought_at IS NULL').run(paintId);
  else ensureOnList(db, paintId);
}

const isDuplicate = (err: unknown) => (err as { code?: string }).code === 'SQLITE_CONSTRAINT_UNIQUE';

interface ShoppingRow {
  id: number;
  paint_id: number | null;
  label: string | null;
  note: string | null;
  created_at: string;
  bought_at: string | null;
  brand: string | null;
  range: string | null;
  paint_name: string | null;
  color_hex: string | null;
  stock: PaintStock | null;
}

const SHOPPING_SELECT = `
  SELECT s.*, p.brand, p.range, p.name AS paint_name, p.color_hex, p.stock
  FROM shopping_items s LEFT JOIN paints p ON p.id = s.paint_id`;

const toItem = (r: ShoppingRow): ShoppingItem => ({
  id: r.id,
  paint: r.paint_id
    ? ({ id: r.paint_id, brand: r.brand!, range: r.range!, name: r.paint_name!, colorHex: r.color_hex, stock: r.stock! } satisfies PaintRef)
    : null,
  label: r.label,
  note: r.note,
  createdAt: r.created_at,
  boughtAt: r.bought_at,
});

export function paintRoutes(app: FastifyInstance, { db, config }: Ctx) {
  app.get('/paints', (req) => {
    const query = req.query as { q?: string; brand?: string; stock?: string };
    const where: string[] = [];
    const params: unknown[] = [];
    if (query.q?.trim()) {
      const like = `%${query.q.trim().replace(/[\\%_]/g, '\\$&')}%`;
      where.push(`(p.name LIKE ? ESCAPE '\\' OR p.brand LIKE ? ESCAPE '\\' OR p.range LIKE ? ESCAPE '\\' OR p.type LIKE ? ESCAPE '\\')`);
      params.push(like, like, like, like);
    }
    if (query.brand) {
      where.push('p.brand = ? COLLATE NOCASE');
      params.push(query.brand);
    }
    const stocks = (query.stock ?? '').split(',').filter((s) => (PAINT_STOCKS as readonly string[]).includes(s));
    if (stocks.length > 0) {
      where.push(`p.stock IN (${stocks.map(() => '?').join(',')})`);
      params.push(...stocks);
    }
    const rows = db
      .prepare(
        `${SELECT} ${where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''}
         ORDER BY p.brand COLLATE NOCASE, p.range COLLATE NOCASE, p.name COLLATE NOCASE`,
      )
      .all(...params) as PaintRow[];
    return rows.map(toPaint);
  });

  app.post('/paints', (req, reply) => {
    const input = paintInputSchema.parse(req.body);
    const stock = input.stock ?? 'owned';
    try {
      const id = db.transaction(() => {
        const ts = now();
        const newId = Number(
          db
            .prepare(
              `INSERT INTO paints (brand, range, name, type, color_hex, stock, notes, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            )
            .run(input.brand, input.range ?? '', input.name, input.type ?? null, input.colorHex ?? null, stock, input.notes ?? null, ts, ts)
            .lastInsertRowid,
        );
        syncList(db, newId, stock);
        return newId;
      })();
      reply.code(201);
      return getPaint(db, id);
    } catch (err) {
      if (isDuplicate(err)) throw new HttpError(409, 'This paint is already in your inventory');
      throw err;
    }
  });

  // Adds many paints at once (catalogue picks, CSV import). Existing ones are left untouched.
  app.post('/paints/bulk', (req): PaintBulkResult => {
    const { items } = paintBulkSchema.parse(req.body);
    const insert = db.prepare(
      `INSERT OR IGNORE INTO paints (brand, range, name, type, color_hex, stock, notes, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const added = db.transaction(() => {
      const ts = now();
      let count = 0;
      for (const item of items) {
        const stock = item.stock ?? 'owned';
        const result = insert.run(item.brand, item.range ?? '', item.name, item.type ?? null, item.colorHex ?? null, stock, item.notes ?? null, ts, ts);
        if (result.changes === 0) continue;
        count++;
        syncList(db, Number(result.lastInsertRowid), stock);
      }
      return count;
    })();
    return { added, skipped: items.length - added };
  });

  // Gives a colour to inventory paints that have none, taking it from the catalogue.
  // A paint that already has a colour is never touched: it may have been corrected by hand.
  app.post('/paints/fill-colours', () => {
    const catalogue = loadCatalog(config, app.log).filter((e) => e.hex);
    const exact = new Map(catalogue.map((e) => [`${e.brand}|${e.range}|${e.name}`.toLowerCase(), e.hex!]));
    // Fallback for paints filed under a different range name: brand and name, when that pair has one colour only.
    const loose = new Map<string, string | null>();
    for (const e of catalogue) {
      const key = `${e.brand}|${e.name}`.toLowerCase();
      loose.set(key, loose.has(key) && loose.get(key) !== e.hex ? null : e.hex!);
    }
    const blank = db.prepare('SELECT id, brand, range, name FROM paints WHERE color_hex IS NULL').all() as { id: number; brand: string; range: string; name: string }[];
    const update = db.prepare('UPDATE paints SET color_hex = ?, updated_at = ? WHERE id = ?');
    const filled = db.transaction(() => {
      let count = 0;
      for (const p of blank) {
        const hex = exact.get(`${p.brand}|${p.range}|${p.name}`.toLowerCase()) ?? loose.get(`${p.brand}|${p.name}`.toLowerCase());
        if (!hex) continue;
        update.run(hex, now(), p.id);
        count++;
      }
      return count;
    })();
    return { filled, stillMissing: blank.length - filled };
  });

  app.get('/paints/export.csv', (_req, reply) => {
    const rows = db
      .prepare('SELECT brand, range, name, type, color_hex, stock, notes FROM paints ORDER BY brand COLLATE NOCASE, range COLLATE NOCASE, name COLLATE NOCASE')
      .raw()
      .all() as (string | null)[][];
    const cell = (v: string | null) => (v === null ? '' : /[",\n\r]/.test(v) ? `"${v.replaceAll('"', '""')}"` : v);
    const csv = [['brand', 'range', 'name', 'type', 'color', 'stock', 'notes'], ...rows].map((r) => r.map(cell).join(',')).join('\r\n');
    return reply
      .type('text/csv; charset=utf-8')
      .header('Content-Disposition', 'attachment; filename="minibald-paints.csv"')
      .send(`\uFEFF${csv}\r\n`); // BOM so Excel opens it as UTF-8
  });

  // The reference catalogue, with a marker on what is already in the inventory.
  app.get('/catalog', (): CatalogEntry[] => {
    const owned = new Map(
      (db.prepare('SELECT id, brand, range, name FROM paints').all() as { id: number; brand: string; range: string; name: string }[]).map((p) => [
        `${p.brand}|${p.range}|${p.name}`.toLowerCase(),
        p.id,
      ]),
    );
    return loadCatalog(config, app.log).map((e) => ({
      ...e,
      paintId: owned.get(`${e.brand}|${e.range}|${e.name}`.toLowerCase()) ?? null,
    }));
  });

  app.patch('/paints/:id', (req) => {
    const id = parseId((req.params as { id: string }).id);
    const input = paintPatchSchema.parse(req.body);
    const current = getPaint(db, id);
    if (!current) throw notFound('Paint');
    const stock = input.stock ?? current.stock;
    try {
      db.transaction(() => {
        db.prepare(
          `UPDATE paints SET brand = ?, range = ?, name = ?, type = ?, color_hex = ?, stock = ?, notes = ?, updated_at = ? WHERE id = ?`,
        ).run(
          input.brand ?? current.brand,
          input.range ?? current.range,
          input.name ?? current.name,
          input.type === undefined ? current.type : input.type,
          input.colorHex === undefined ? current.colorHex : input.colorHex,
          stock,
          input.notes === undefined ? current.notes : input.notes,
          now(),
          id,
        );
        if (stock !== current.stock) syncList(db, id, stock);
        // Recipe steps show a text label for the paint; keep it current after a rename.
        db.prepare(`UPDATE recipe_steps SET paint_label = ? WHERE paint_id = ?`).run(
          `${input.brand ?? current.brand} ${input.name ?? current.name}`,
          id,
        );
      })();
    } catch (err) {
      if (isDuplicate(err)) throw new HttpError(409, 'Another paint already has this brand, range and name');
      throw err;
    }
    return getPaint(db, id);
  });

  app.delete('/paints/:id', (req, reply) => {
    db.prepare('DELETE FROM paints WHERE id = ?').run(parseId((req.params as { id: string }).id));
    return reply.code(204).send();
  });

  // ---- Shopping list ----
  const getItem = (id: number) => {
    const row = db.prepare(`${SHOPPING_SELECT} WHERE s.id = ?`).get(id) as ShoppingRow | undefined;
    return row && toItem(row);
  };

  app.get('/shopping', () =>
    (db.prepare(`${SHOPPING_SELECT} ORDER BY s.bought_at IS NOT NULL, s.created_at DESC, s.id DESC`).all() as ShoppingRow[]).map(toItem),
  );

  app.post('/shopping', (req, reply) => {
    const input = shoppingInputSchema.parse(req.body);
    let id: number;
    if (input.paintId != null) {
      if (!getPaint(db, input.paintId)) throw new HttpError(400, 'Paint does not exist');
      id = ensureOnList(db, input.paintId);
      if (input.note) db.prepare('UPDATE shopping_items SET note = ? WHERE id = ?').run(input.note, id);
    } else {
      // Free-text items are de-duplicated too, so "add missing paints" can be pressed twice.
      const existing = db
        .prepare('SELECT id FROM shopping_items WHERE paint_id IS NULL AND label = ? COLLATE NOCASE AND bought_at IS NULL')
        .pluck()
        .get(input.label) as number | undefined;
      id =
        existing ??
        Number(
          db.prepare('INSERT INTO shopping_items (label, note, created_at) VALUES (?, ?, ?)').run(input.label, input.note ?? null, now())
            .lastInsertRowid,
        );
    }
    reply.code(201);
    return getItem(id);
  });

  app.patch('/shopping/:id', (req) => {
    const id = parseId((req.params as { id: string }).id);
    const input = shoppingPatchSchema.parse(req.body);
    const current = getItem(id);
    if (!current) throw notFound('Shopping item');
    db.transaction(() => {
      db.prepare('UPDATE shopping_items SET label = ?, note = ?, bought_at = ? WHERE id = ?').run(
        input.label === undefined ? current.label : input.label,
        input.note === undefined ? current.note : input.note,
        input.bought === undefined ? current.boughtAt : input.bought ? (current.boughtAt ?? now()) : null,
        id,
      );
      // Buying a paint restocks it.
      if (input.bought && current.paint) {
        db.prepare(`UPDATE paints SET stock = 'owned', updated_at = ? WHERE id = ?`).run(now(), current.paint.id);
      }
    })();
    return getItem(id);
  });

  app.delete('/shopping/bought', (_req, reply) => {
    db.prepare('DELETE FROM shopping_items WHERE bought_at IS NOT NULL').run();
    return reply.code(204).send();
  });

  app.delete('/shopping/:id', (req, reply) => {
    db.prepare('DELETE FROM shopping_items WHERE id = ?').run(parseId((req.params as { id: string }).id));
    return reply.code(204).send();
  });
}
