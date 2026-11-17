import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import sharp from 'sharp';
import {
  PHASE_LABELS,
  aiFeedbackRequestSchema,
  aiFeedbackSchema,
  aiRecipeRequestSchema,
  aiRecipeSchema,
  aiTutorialsRequestSchema,
  aiTutorialsSchema,
  type AiFeedback,
  type AiKind,
  type AiRecipe,
  type AiRun,
  type AiStatus,
  type AiTutorials,
  type PaintRef,
  type PaintStock,
} from '@minibald/shared';
import { ZodError } from 'zod';
import type { Ctx } from '../app.ts';
import { AiError, type AiImage, type AiResult, type InventoryPaint, type MiniatureBrief } from '../ai/provider.ts';
import { HttpError, notFound, now, parseId } from '../lib/http.ts';
import { getMiniRow, touch } from '../services/miniatures.ts';
import type { PhotoRow } from '../services/photos.ts';
import { writeSteps } from './recipes.ts';

interface RunRow {
  id: number;
  miniature_id: number | null;
  kind: AiKind;
  provider: string;
  model: string;
  photo_id: number | null;
  input_json: string;
  output_json: string;
  input_tokens: number | null;
  output_tokens: number | null;
  created_at: string;
}

interface PaintRow {
  id: number;
  brand: string;
  range: string;
  name: string;
  type: string | null;
  color_hex: string | null;
  stock: PaintStock;
}

const key = (label: string) => label.trim().toLowerCase().replace(/\s+/g, ' ');

export function aiRoutes(app: FastifyInstance, { db, config, ai }: Ctx) {
  const provider = () => {
    if (!ai) throw new HttpError(503, 'The AI assistant is not configured. Set ANTHROPIC_API_KEY in .env and restart.');
    return ai;
  };

  const paints = () => db.prepare('SELECT id, brand, range, name, type, color_hex, stock FROM paints').all() as PaintRow[];

  /** Inventory lookup by the "Brand Name" label the model was told to copy. */
  const paintIndex = () =>
    new Map(
      paints().map((p) => [
        key(`${p.brand} ${p.name}`),
        { id: p.id, brand: p.brand, range: p.range, name: p.name, colorHex: p.color_hex, stock: p.stock } satisfies PaintRef,
      ]),
    );

  function miniBrief(id: number): MiniatureBrief {
    const m = getMiniRow(db, id);
    if (!m) throw new HttpError(400, 'Miniature does not exist');
    const parent = m.group_id
      ? (db.prepare('SELECT p.name FROM groups g JOIN groups p ON p.id = g.parent_id WHERE g.id = ?').pluck().get(m.group_id) as string | undefined)
      : undefined;
    const tags = db
      .prepare('SELECT t.name FROM miniature_tags mt JOIN tags t ON t.id = mt.tag_id WHERE mt.miniature_id = ?')
      .pluck()
      .all(id) as string[];
    return { name: m.name, group: m.group_name, parentGroup: parent ?? null, description: m.description, notes: m.notes, status: m.status, quantity: m.quantity, tags };
  }

  /** Photos are re-encoded to a bounded JPEG before leaving the machine: predictable size and token cost. */
  async function loadImage(photoId: number, miniatureId: number): Promise<AiImage> {
    const photo = db.prepare('SELECT * FROM photos WHERE id = ?').get(photoId) as PhotoRow | undefined;
    if (!photo || photo.miniature_id !== miniatureId) throw new HttpError(400, 'Photo does not belong to this miniature');
    const buffer = await sharp(path.join(config.dataDir, photo.path))
      .rotate()
      .resize({ width: config.ai.imageMaxEdge, height: config.ai.imageMaxEdge, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 85 })
      .toBuffer();
    return { mediaType: 'image/jpeg', base64: buffer.toString('base64') };
  }

  function toRun(row: RunRow): AiRun {
    const base = {
      id: row.id,
      miniatureId: row.miniature_id,
      provider: row.provider,
      model: row.model,
      photoId: row.photo_id,
      prompt: (JSON.parse(row.input_json) as { prompt?: string | null }).prompt ?? null,
      inputTokens: row.input_tokens,
      outputTokens: row.output_tokens,
      createdAt: row.created_at,
    };
    const output = JSON.parse(row.output_json) as unknown;
    if (row.kind === 'recipe') {
      // Ownership is worked out here, against today's inventory, rather than trusted from the model.
      const index = paintIndex();
      const recipe = output as AiRecipe;
      return {
        ...base,
        kind: 'recipe',
        output: { ...recipe, steps: recipe.steps.map((st) => ({ ...st, paintRef: st.paint ? (index.get(key(st.paint)) ?? null) : null })) },
        savedRecipeId: (db.prepare('SELECT id FROM recipes WHERE ai_run_id = ?').pluck().get(row.id) as number | undefined) ?? null,
      };
    }
    return row.kind === 'feedback' ? { ...base, kind: 'feedback', output: output as AiFeedback } : { ...base, kind: 'tutorials', output: output as AiTutorials };
  }

  const getRun = (id: number) => db.prepare(`SELECT * FROM ai_runs WHERE id = ? AND status = 'ok'`).get(id) as RunRow | undefined;

  /**
   * Runs one request end to end: call the provider, validate what came back against the shared
   * schema, store it. Failures are recorded too, so a broken key or a refusal leaves a trace.
   */
  async function run<T>(
    kind: AiKind,
    miniatureId: number,
    photoId: number | null,
    prompt: string | null,
    schema: { parse: (v: unknown) => T },
    call: () => Promise<AiResult<T>>,
  ): Promise<AiRun> {
    const ai = provider();
    const insert = db.prepare(
      `INSERT INTO ai_runs (miniature_id, kind, provider, model, photo_id, input_json, output_json, status, error, input_tokens, output_tokens, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const input = JSON.stringify({ prompt });
    try {
      const result = await call();
      const output = schema.parse(result.output);
      const { lastInsertRowid } = insert.run(miniatureId, kind, ai.name, result.model, photoId, input, JSON.stringify(output), 'ok', null, result.inputTokens, result.outputTokens, now());
      return toRun(getRun(Number(lastInsertRowid))!);
    } catch (err) {
      const message = err instanceof ZodError ? 'The model returned data in an unexpected shape. Try again.' : (err as Error).message;
      insert.run(miniatureId, kind, ai.name, ai.model, photoId, input, null, 'error', message.slice(0, 1000), null, null, now());
      if (err instanceof AiError) throw new HttpError(err.status, err.message);
      if (err instanceof ZodError) throw new HttpError(502, message);
      throw err;
    }
  }

  app.get('/ai/status', (): AiStatus => ({ configured: ai !== null, provider: ai?.name ?? null, model: ai?.model ?? null }));

  app.post('/ai/recipe', async (req) => {
    const input = aiRecipeRequestSchema.parse(req.body);
    provider();
    const miniature = miniBrief(input.miniatureId);
    const image = input.photoId != null ? await loadImage(input.photoId, input.miniatureId) : null;
    const inventory: InventoryPaint[] = paints().map((p) => ({ label: `${p.brand} ${p.name}`, range: p.range, type: p.type, stock: p.stock }));
    return run('recipe', input.miniatureId, input.photoId ?? null, input.scheme ?? null, aiRecipeSchema, () =>
      provider().suggestRecipe({ miniature, scheme: input.scheme ?? null, inventory, image, language: config.ai.language }),
    );
  });

  app.post('/ai/feedback', async (req) => {
    const input = aiFeedbackRequestSchema.parse(req.body);
    provider();
    const miniature = miniBrief(input.miniatureId);
    const image = await loadImage(input.photoId, input.miniatureId);
    // If a recipe is being followed, the model sees it and can say which step to revisit.
    const steps = db
      .prepare(
        `SELECT r.name, s.phase, s.area, s.paint_label, s.technique, s.done_at FROM recipe_steps s JOIN recipes r ON r.id = s.recipe_id
         WHERE r.miniature_id = ? ORDER BY r.created_at, s.position LIMIT 80`,
      )
      .all(input.miniatureId) as { name: string; phase: keyof typeof PHASE_LABELS; area: string | null; paint_label: string | null; technique: string | null; done_at: string | null }[];
    const recipe =
      steps.length > 0
        ? steps.map((s) => `- [${s.done_at ? 'done' : 'to do'}] ${PHASE_LABELS[s.phase]}: ${[s.area, s.paint_label, s.technique].filter(Boolean).join(', ')}`).join('\n')
        : null;
    return run('feedback', input.miniatureId, input.photoId, input.focus ?? null, aiFeedbackSchema, () =>
      provider().critique({ miniature, focus: input.focus ?? null, recipe, image, language: config.ai.language }),
    );
  });

  app.post('/ai/tutorials', async (req) => {
    const input = aiTutorialsRequestSchema.parse(req.body);
    provider();
    const miniature = miniBrief(input.miniatureId);
    return run('tutorials', input.miniatureId, null, input.query ?? null, aiTutorialsSchema, () =>
      provider().findTutorials({ miniature, query: input.query ?? null, language: config.ai.language }),
    );
  });

  app.get('/ai/runs', (req) => {
    const { miniature } = req.query as { miniature?: string };
    if (!miniature) throw new HttpError(400, 'miniature is required');
    const rows = db
      .prepare(`SELECT * FROM ai_runs WHERE miniature_id = ? AND status = 'ok' ORDER BY created_at DESC, id DESC LIMIT 50`)
      .all(parseId(miniature)) as RunRow[];
    return rows.map(toRun);
  });

  // Turns a stored suggestion into a normal recipe on the miniature. Nothing is re-asked of
  // the model: the steps come from the validated JSON saved with the run.
  app.post('/ai/runs/:id/save-recipe', (req, reply) => {
    const id = parseId((req.params as { id: string }).id);
    const row = getRun(id);
    if (!row || row.kind !== 'recipe') throw notFound('Recipe suggestion');
    if (row.miniature_id === null) throw new HttpError(409, 'The miniature this suggestion was made for no longer exists');
    const run = toRun(row) as Extract<AiRun, { kind: 'recipe' }>;
    if (run.savedRecipeId !== null) return { recipeId: run.savedRecipeId };

    const recipeId = db.transaction(() => {
      const ts = now();
      const newId = Number(
        db
          .prepare(`INSERT INTO recipes (miniature_id, name, description, source, ai_run_id, created_at, updated_at) VALUES (?, ?, ?, 'ai', ?, ?, ?)`)
          .run(row.miniature_id, run.output.name.slice(0, 140), [run.output.summary, ...run.output.tips.map((t) => `• ${t}`)].join('\n').slice(0, 4000), id, ts, ts)
          .lastInsertRowid,
      );
      writeSteps(
        db,
        newId,
        run.output.steps.map((st) => ({
          phase: st.phase,
          area: st.area.slice(0, 80) || null,
          paintId: st.paintRef?.id ?? null,
          paintLabel: st.paintRef ? null : (st.paint?.slice(0, 140) ?? null),
          technique: st.technique.slice(0, 80) || null,
          notes: [st.notes, st.alternative && !st.paintRef ? `Substitute from your paints: ${st.alternative}.` : null].filter(Boolean).join(' ').slice(0, 1000) || null,
        })),
      );
      touch(db, row.miniature_id!);
      return newId;
    })();
    reply.code(201);
    return { recipeId };
  });

  app.delete('/ai/runs/:id', (req, reply) => {
    db.prepare('DELETE FROM ai_runs WHERE id = ?').run(parseId((req.params as { id: string }).id));
    return reply.code(204).send();
  });
}
