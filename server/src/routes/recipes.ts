import type { FastifyInstance } from 'fastify';
import {
  recipeDuplicateSchema,
  recipeInputSchema,
  recipePatchSchema,
  stepDoneSchema,
  type PaintStock,
  type Recipe,
  type RecipePhase,
  type RecipeStep,
} from '@minibald/shared';
import type { z } from 'zod';
import type { recipeStepInputSchema } from '@minibald/shared';
import type { Ctx } from '../app.ts';
import type { Db } from '../db/connection.ts';
import { HttpError, notFound, now, parseId } from '../lib/http.ts';
import { touch } from '../services/miniatures.ts';

type StepInput = z.output<typeof recipeStepInputSchema>;

interface RecipeRow {
  id: number;
  miniature_id: number | null;
  miniature_name: string | null;
  name: string;
  description: string | null;
  source: Recipe['source'];
  source_recipe_id: number | null;
  created_at: string;
  updated_at: string;
}

interface StepRow {
  id: number;
  recipe_id: number;
  position: number;
  phase: RecipePhase;
  area: string | null;
  paint_id: number | null;
  paint_label: string | null;
  technique: string | null;
  notes: string | null;
  done_at: string | null;
  p_id: number | null;
  brand: string | null;
  range: string | null;
  paint_name: string | null;
  color_hex: string | null;
  stock: PaintStock | null;
}

const RECIPE_SELECT = `SELECT r.*, m.name AS miniature_name FROM recipes r LEFT JOIN miniatures m ON m.id = r.miniature_id`;

function loadRecipes(db: Db, where: string, params: unknown[]): Recipe[] {
  const rows = db.prepare(`${RECIPE_SELECT} ${where} ORDER BY r.created_at, r.id`).all(...params) as RecipeRow[];
  if (rows.length === 0) return [];
  const steps = db
    .prepare(
      `SELECT s.*, p.id AS p_id, p.brand, p.range, p.name AS paint_name, p.color_hex, p.stock
       FROM recipe_steps s LEFT JOIN paints p ON p.id = s.paint_id
       WHERE s.recipe_id IN (${rows.map(() => '?').join(',')}) ORDER BY s.position, s.id`,
    )
    .all(...rows.map((r) => r.id)) as StepRow[];
  const byRecipe = new Map<number, RecipeStep[]>();
  for (const s of steps) {
    const list = byRecipe.get(s.recipe_id) ?? [];
    list.push({
      id: s.id,
      position: s.position,
      phase: s.phase,
      area: s.area,
      paint: s.p_id ? { id: s.p_id, brand: s.brand!, range: s.range!, name: s.paint_name!, colorHex: s.color_hex, stock: s.stock! } : null,
      paintLabel: s.paint_label,
      technique: s.technique,
      notes: s.notes,
      doneAt: s.done_at,
    });
    byRecipe.set(s.recipe_id, list);
  }
  return rows.map((r) => ({
    id: r.id,
    miniatureId: r.miniature_id,
    miniatureName: r.miniature_name,
    name: r.name,
    description: r.description,
    source: r.source,
    sourceRecipeId: r.source_recipe_id,
    steps: byRecipe.get(r.id) ?? [],
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }));
}

const getRecipe = (db: Db, id: number) => loadRecipes(db, 'WHERE r.id = ?', [id])[0];

/**
 * Replaces a recipe's steps with the given ordered list. Steps that carry an id they
 * already had keep it — and their tick — so editing a recipe mid-paint loses nothing.
 */
export function writeSteps(db: Db, recipeId: number, steps: StepInput[]) {
  const existing = new Map(
    (db.prepare('SELECT id, done_at FROM recipe_steps WHERE recipe_id = ?').all(recipeId) as { id: number; done_at: string | null }[]).map(
      (s) => [s.id, s.done_at],
    ),
  );
  const paintName = db.prepare(`SELECT brand || ' ' || name FROM paints WHERE id = ?`).pluck();
  const insert = db.prepare(
    `INSERT INTO recipe_steps (id, recipe_id, position, phase, area, paint_id, paint_label, technique, notes, done_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  db.prepare('DELETE FROM recipe_steps WHERE recipe_id = ?').run(recipeId);
  steps.forEach((step, position) => {
    let label = step.paintLabel ?? null;
    if (step.paintId != null) {
      label = (paintName.get(step.paintId) as string | undefined) ?? null;
      if (label === null) throw new HttpError(400, `Step ${position + 1}: paint does not exist`);
    }
    const kept = step.id !== undefined && existing.has(step.id);
    insert.run(
      kept ? step.id : null,
      recipeId,
      position,
      step.phase,
      step.area ?? null,
      step.paintId ?? null,
      label,
      step.technique ?? null,
      step.notes ?? null,
      kept ? existing.get(step.id!) : null,
    );
  });
}

export function recipeRoutes(app: FastifyInstance, { db }: Ctx) {
  const miniExists = (id: number) => Boolean(db.prepare('SELECT 1 FROM miniatures WHERE id = ?').get(id));

  // ?miniature=ID lists a miniature's recipes; without it, the reusable library.
  app.get('/recipes', (req) => {
    const { miniature } = req.query as { miniature?: string };
    return miniature
      ? loadRecipes(db, 'WHERE r.miniature_id = ?', [parseId(miniature)])
      : loadRecipes(db, 'WHERE r.miniature_id IS NULL', []);
  });

  app.get('/recipes/:id', (req) => {
    const recipe = getRecipe(db, parseId((req.params as { id: string }).id));
    if (!recipe) throw notFound('Recipe');
    return recipe;
  });

  app.post('/recipes', (req, reply) => {
    const input = recipeInputSchema.parse(req.body);
    if (input.miniatureId != null && !miniExists(input.miniatureId)) throw new HttpError(400, 'Miniature does not exist');
    const id = db.transaction(() => {
      const ts = now();
      const newId = Number(
        db
          .prepare('INSERT INTO recipes (miniature_id, name, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
          .run(input.miniatureId ?? null, input.name, input.description ?? null, ts, ts).lastInsertRowid,
      );
      writeSteps(db, newId, input.steps ?? []);
      if (input.miniatureId != null) touch(db, input.miniatureId);
      return newId;
    })();
    reply.code(201);
    return getRecipe(db, id);
  });

  app.patch('/recipes/:id', (req) => {
    const id = parseId((req.params as { id: string }).id);
    const input = recipePatchSchema.parse(req.body);
    const current = getRecipe(db, id);
    if (!current) throw notFound('Recipe');
    db.transaction(() => {
      db.prepare('UPDATE recipes SET name = ?, description = ?, updated_at = ? WHERE id = ?').run(
        input.name ?? current.name,
        input.description === undefined ? current.description : input.description,
        now(),
        id,
      );
      if (input.steps) writeSteps(db, id, input.steps);
    })();
    return getRecipe(db, id);
  });

  app.delete('/recipes/:id', (req, reply) => {
    db.prepare('DELETE FROM recipes WHERE id = ?').run(parseId((req.params as { id: string }).id));
    return reply.code(204).send();
  });

  // Copies a recipe onto a miniature (or into the library) with every tick cleared.
  app.post('/recipes/:id/duplicate', (req, reply) => {
    const id = parseId((req.params as { id: string }).id);
    const input = recipeDuplicateSchema.parse(req.body);
    const source = getRecipe(db, id);
    if (!source) throw notFound('Recipe');
    if (input.miniatureId !== null && !miniExists(input.miniatureId)) throw new HttpError(400, 'Miniature does not exist');
    const newId = db.transaction(() => {
      const ts = now();
      const copyId = Number(
        db
          .prepare(
            `INSERT INTO recipes (miniature_id, name, description, source, source_recipe_id, created_at, updated_at)
             VALUES (?, ?, ?, 'copy', ?, ?, ?)`,
          )
          .run(input.miniatureId, input.name ?? source.name, source.description, id, ts, ts).lastInsertRowid,
      );
      db.prepare(
        `INSERT INTO recipe_steps (recipe_id, position, phase, area, paint_id, paint_label, technique, notes)
         SELECT ?, position, phase, area, paint_id, paint_label, technique, notes FROM recipe_steps WHERE recipe_id = ?`,
      ).run(copyId, id);
      if (input.miniatureId !== null) touch(db, input.miniatureId);
      return copyId;
    })();
    reply.code(201);
    return getRecipe(db, newId);
  });

  app.patch('/recipe-steps/:id', (req) => {
    const id = parseId((req.params as { id: string }).id);
    const { done } = stepDoneSchema.parse(req.body);
    const step = db
      .prepare('SELECT s.recipe_id, r.miniature_id FROM recipe_steps s JOIN recipes r ON r.id = s.recipe_id WHERE s.id = ?')
      .get(id) as { recipe_id: number; miniature_id: number | null } | undefined;
    if (!step) throw notFound('Step');
    db.prepare('UPDATE recipe_steps SET done_at = ? WHERE id = ?').run(done ? now() : null, id);
    if (step.miniature_id !== null) touch(db, step.miniature_id);
    return getRecipe(db, step.recipe_id);
  });
}

