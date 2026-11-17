import { z } from 'zod';

// ---------- Status ----------
export const STATUSES = ['unassembled', 'assembled', 'primed', 'in_progress', 'finished'] as const;
export type Status = (typeof STATUSES)[number];
export const statusSchema = z.enum(STATUSES);

export const STATUS_LABELS: Record<Status, string> = {
  unassembled: 'To build',
  assembled: 'Built',
  primed: 'Primed',
  in_progress: 'In progress',
  finished: 'Finished',
};

// ---------- Inputs (validated by the server, typed in the client) ----------
const text = (max: number) => z.string().trim().max(max);
const optionalText = (max: number) =>
  text(max)
    .nullish()
    .transform((v) => (v === undefined ? undefined : v || null));
const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Expected a #rrggbb colour');

export const groupInputSchema = z.object({
  name: text(120).min(1),
  parentId: z.number().int().positive().nullish(),
  kind: optionalText(60),
  description: optionalText(4000),
  color: hexColor.nullish(),
  sortOrder: z.number().int().optional(),
});
export const groupPatchSchema = groupInputSchema.partial();
export type GroupInput = z.input<typeof groupInputSchema>;

export const miniatureInputSchema = z.object({
  name: text(160).min(1),
  groupId: z.number().int().positive().nullish(),
  description: optionalText(8000),
  notes: optionalText(20000),
  quantity: z.number().int().min(1).max(999).optional(),
  acquiredOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
  startedAt: z.iso.datetime().nullish(),
  finishedAt: z.iso.datetime().nullish(),
  tags: z.array(text(40).min(1)).max(30).optional(),
});
export const miniatureCreateSchema = miniatureInputSchema.extend({ status: statusSchema.optional() });
export const miniaturePatchSchema = miniatureInputSchema.partial();
export type MiniatureInput = z.input<typeof miniatureCreateSchema>;

export const statusChangeSchema = z.object({ status: statusSchema });

export const photoPatchSchema = z.object({
  caption: optionalText(500),
  takenAt: z.iso.datetime().optional(),
  stage: statusSchema.nullish(),
});
export type PhotoPatch = z.input<typeof photoPatchSchema>;

export const coverSchema = z.object({ photoId: z.number().int().positive().nullable() });

export const tagPatchSchema = z.object({ name: text(40).min(1).optional(), color: hexColor.nullish() });

// ---------- DTOs ----------
export type StatusCounts = Record<Status, number>;

export interface Group {
  id: number;
  parentId: number | null;
  name: string;
  slug: string;
  kind: string | null;
  description: string | null;
  color: string | null;
  sortOrder: number;
  /** Cards directly in this group. */
  miniCount: number;
  /** Models (sum of quantity) directly in this group, per status. */
  counts: StatusCounts;
  createdAt: string;
  updatedAt: string;
}

export interface Tag {
  id: number;
  name: string;
  color: string | null;
  miniCount: number;
}

export interface Photo {
  id: number;
  miniatureId: number;
  path: string;
  width: number | null;
  height: number | null;
  bytes: number | null;
  stage: Status | null;
  caption: string | null;
  takenAt: string;
  createdAt: string;
}

export interface MiniatureSummary {
  id: number;
  name: string;
  slug: string;
  group: { id: number; name: string; color: string | null } | null;
  description: string | null;
  notes: string | null;
  status: Status;
  quantity: number;
  /** Explicit cover, or the most recent photo when none is chosen. */
  coverPhotoId: number | null;
  photoCount: number;
  tags: string[];
  acquiredOn: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Miniature extends MiniatureSummary {
  /** Total time logged in painting sessions. */
  paintedSeconds: number;
  /** Folder (relative to the data dir) holding this miniature's photos. */
  folder: string;
  hasExplicitCover: boolean;
  photos: Photo[];
}

export interface MiniatureList {
  items: MiniatureSummary[];
  total: number;
}

export interface StatusChangeResult {
  miniature: Miniature;
  /** Achievement keys unlocked by this change (filled in from Phase 4). */
  unlocked: string[];
}

export interface Dashboard {
  /** Models (sum of quantity) per status. */
  models: StatusCounts;
  cards: number;
  totalModels: number;
  /** Models not finished yet. */
  pile: number;
  finishedThisMonth: number;
  paintedSecondsThisMonth: number;
  paintedSecondsTotal: number;
  continueWith: MiniatureSummary | null;
  inProgress: MiniatureSummary[];
  groups: { id: number | null; name: string; color: string | null; counts: StatusCounts }[];
  recentPhotos: (Photo & { miniatureName: string })[];
}

export interface Health {
  ok: true;
  version: string;
  schemaVersion: number;
  aiConfigured: boolean;
}

// ---------- Paints ----------
export const PAINT_STOCKS = ['owned', 'low', 'out', 'wanted'] as const;
export type PaintStock = (typeof PAINT_STOCKS)[number];
export const STOCK_LABELS: Record<PaintStock, string> = {
  owned: 'In stock',
  low: 'Running low',
  out: 'Empty',
  wanted: 'Wishlist',
};

export const paintInputSchema = z.object({
  brand: text(60).min(1),
  range: text(60).optional(),
  name: text(100).min(1),
  type: optionalText(40),
  colorHex: hexColor.nullish(),
  stock: z.enum(PAINT_STOCKS).optional(),
  notes: optionalText(1000),
});
export const paintPatchSchema = paintInputSchema.partial();
export type PaintInput = z.input<typeof paintInputSchema>;

export interface Paint {
  id: number;
  brand: string;
  range: string;
  name: string;
  type: string | null;
  colorHex: string | null;
  stock: PaintStock;
  notes: string | null;
  /** Has an open (not yet bought) entry on the shopping list. */
  onShoppingList: boolean;
  /** Recipe steps that use this paint. */
  usedInSteps: number;
  createdAt: string;
  updatedAt: string;
}

export const paintBulkSchema = z.object({ items: z.array(paintInputSchema).min(1).max(3000) });
export interface PaintBulkResult {
  added: number;
  /** Already in the inventory (same brand, range and name). */
  skipped: number;
}

/** A paint in the reference catalogue (bundled files plus anything dropped in data/catalogs). */
export const catalogEntrySchema = z.object({
  brand: text(60).min(1),
  range: text(60).default(''),
  name: text(100).min(1),
  type: text(40).nullish(),
  /** Manufacturer reference, e.g. AK11001. */
  code: text(40).nullish(),
  hex: hexColor.nullish(),
});
export interface CatalogEntry {
  brand: string;
  range: string;
  name: string;
  type: string | null;
  code: string | null;
  hex: string | null;
  /** Id of the matching paint in the inventory, if you already have it. */
  paintId: number | null;
}

/** The slice of a paint embedded in recipe steps and shopping items. */
export type PaintRef = Pick<Paint, 'id' | 'brand' | 'range' | 'name' | 'colorHex' | 'stock'>;
export const paintLabel = (p: Pick<Paint, 'brand' | 'name'>) => `${p.brand} ${p.name}`;

// ---------- Shopping list ----------
export const shoppingInputSchema = z
  .object({ paintId: z.number().int().positive().nullish(), label: optionalText(140), note: optionalText(300) })
  .refine((v) => v.paintId != null || Boolean(v.label), 'Provide a paint or a label');
export const shoppingPatchSchema = z.object({ label: optionalText(140), note: optionalText(300), bought: z.boolean().optional() });

export interface ShoppingItem {
  id: number;
  paint: PaintRef | null;
  label: string | null;
  note: string | null;
  createdAt: string;
  boughtAt: string | null;
}

// ---------- Recipes ----------
export const RECIPE_PHASES = ['prime', 'base', 'shade', 'layer', 'highlight', 'detail', 'basing', 'varnish', 'other'] as const;
export type RecipePhase = (typeof RECIPE_PHASES)[number];
export const PHASE_LABELS: Record<RecipePhase, string> = {
  prime: 'Prime',
  base: 'Base',
  shade: 'Shade',
  layer: 'Layer',
  highlight: 'Highlight',
  detail: 'Detail',
  basing: 'Basing',
  varnish: 'Varnish',
  other: 'Other',
};

export const recipeStepInputSchema = z.object({
  /** Present when editing an existing step: keeps its tick. */
  id: z.number().int().positive().optional(),
  phase: z.enum(RECIPE_PHASES),
  area: optionalText(80),
  paintId: z.number().int().positive().nullish(),
  paintLabel: optionalText(140),
  technique: optionalText(80),
  notes: optionalText(1000),
});
export type RecipeStepInput = z.input<typeof recipeStepInputSchema>;

export const recipeInputSchema = z.object({
  name: text(140).min(1),
  description: optionalText(4000),
  /** null or omitted = library recipe. */
  miniatureId: z.number().int().positive().nullish(),
  steps: z.array(recipeStepInputSchema).max(200).optional(),
});
export const recipePatchSchema = recipeInputSchema.omit({ miniatureId: true }).partial();
export type RecipeInput = z.input<typeof recipeInputSchema>;
export const recipeDuplicateSchema = z.object({
  /** Target miniature, or null to save a copy to the library. */
  miniatureId: z.number().int().positive().nullable(),
  name: text(140).min(1).optional(),
});
export const stepDoneSchema = z.object({ done: z.boolean() });

export interface RecipeStep {
  id: number;
  position: number;
  phase: RecipePhase;
  area: string | null;
  paint: PaintRef | null;
  paintLabel: string | null;
  technique: string | null;
  notes: string | null;
  doneAt: string | null;
}

export interface Recipe {
  id: number;
  miniatureId: number | null;
  miniatureName: string | null;
  name: string;
  description: string | null;
  source: 'manual' | 'ai' | 'copy';
  sourceRecipeId: number | null;
  steps: RecipeStep[];
  createdAt: string;
  updatedAt: string;
}

// ---------- Painting sessions ----------
export const sessionStartSchema = z.object({ miniatureId: z.number().int().positive().nullish() });
export const sessionStopSchema = z.object({ notes: optionalText(1000) });
export const sessionInputSchema = z
  .object({
    miniatureId: z.number().int().positive().nullish(),
    startedAt: z.iso.datetime(),
    endedAt: z.iso.datetime(),
    notes: optionalText(1000),
  })
  .refine((v) => v.endedAt > v.startedAt, 'A session must end after it starts');
export const sessionPatchSchema = z.object({ notes: optionalText(1000), durationSec: z.number().int().min(1).max(86400).optional() });

export interface PaintingSession {
  id: number;
  miniatureId: number | null;
  miniatureName: string | null;
  startedAt: string;
  endedAt: string | null;
  durationSec: number | null;
  notes: string | null;
}

// ---------- AI assistant ----------
export const AI_KINDS = ['recipe', 'feedback', 'tutorials'] as const;
export type AiKind = (typeof AI_KINDS)[number];

/**
 * What the model must return for "How do I paint it?". Sent to the provider as the required
 * output format and checked again by the backend before anything is stored.
 * Every field is required (nullable where it can be absent): structured outputs need that.
 */
export const aiRecipeSchema = z.object({
  name: z.string(),
  summary: z.string(),
  steps: z.array(
    z.object({
      phase: z.enum(RECIPE_PHASES),
      area: z.string(),
      /** "Brand Name", spelled exactly as in the inventory when the paint is owned. */
      paint: z.string().nullable(),
      technique: z.string(),
      notes: z.string(),
      /** For a paint that is not owned: the closest owned substitute, if there is one. */
      alternative: z.string().nullable(),
    }),
  ),
  tips: z.array(z.string()),
});
export type AiRecipe = z.infer<typeof aiRecipeSchema>;

export const aiFeedbackSchema = z.object({
  overall: z.string(),
  strengths: z.array(z.string()),
  improvements: z.array(z.object({ area: z.string(), issue: z.string(), how: z.string() })),
  nextStep: z.string(),
});
export type AiFeedback = z.infer<typeof aiFeedbackSchema>;

export const aiTutorialsSchema = z.object({
  summary: z.string(),
  links: z.array(z.object({ title: z.string(), url: z.url(), snippet: z.string().nullable() })),
});
export type AiTutorials = z.infer<typeof aiTutorialsSchema>;

export const aiRecipeRequestSchema = z.object({
  miniatureId: z.number().int().positive(),
  scheme: optionalText(2000),
  photoId: z.number().int().positive().nullish(),
});
export const aiFeedbackRequestSchema = z.object({
  miniatureId: z.number().int().positive(),
  photoId: z.number().int().positive(),
  focus: optionalText(1000),
});
export const aiTutorialsRequestSchema = z.object({
  miniatureId: z.number().int().positive(),
  query: optionalText(300),
});

/** A recipe suggestion as shown to the user: each step's paint is matched against the inventory. */
export type AiRecipeView = Omit<AiRecipe, 'steps'> & {
  steps: (AiRecipe['steps'][number] & { paintRef: PaintRef | null })[];
};

interface AiRunBase {
  id: number;
  miniatureId: number | null;
  provider: string;
  model: string;
  photoId: number | null;
  /** The free-text part of the request: scheme idea, focus or extra search words. */
  prompt: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  createdAt: string;
}
export type AiRun =
  | (AiRunBase & { kind: 'recipe'; output: AiRecipeView; savedRecipeId: number | null })
  | (AiRunBase & { kind: 'feedback'; output: AiFeedback })
  | (AiRunBase & { kind: 'tutorials'; output: AiTutorials });

export interface AiStatus {
  configured: boolean;
  provider: string | null;
  model: string | null;
}

// ---------- Motivation ----------
export interface Streak {
  /** Consecutive painting days ending today, or yesterday if today has no activity yet. */
  current: number;
  best: number;
  paintedToday: boolean;
  /** The last 14 local days, oldest first. */
  recent: { day: string; active: boolean }[];
}

export interface Achievement {
  key: string;
  title: string;
  description: string;
  /** Icon name from the client icon set. */
  icon: string;
  /** Index (1-6) of the theme paint used for the medal. */
  paint: number;
  unlockedAt: string | null;
  /** False for a freshly unlocked badge whose celebration has not been shown yet. */
  seen: boolean;
  progress: { current: number; target: number };
}

export const achievementsSeenSchema = z.object({ keys: z.array(z.string().max(60)).min(1).max(100) });

export const CHALLENGE_KINDS = ['finish_miniatures', 'finish_count', 'paint_hours', 'streak_days'] as const;
export type ChallengeKind = (typeof CHALLENGE_KINDS)[number];
export const CHALLENGE_KIND_LABELS: Record<ChallengeKind, string> = {
  finish_miniatures: 'Finish specific miniatures',
  finish_count: 'Finish a number of models',
  paint_hours: 'Paint for a number of hours',
  streak_days: 'Paint several days in a row',
};

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export const challengeInputSchema = z
  .object({
    title: text(140).min(1),
    description: optionalText(1000),
    kind: z.enum(CHALLENGE_KINDS),
    target: z.number().int().min(1).max(10000).nullish(),
    groupId: z.number().int().positive().nullish(),
    miniatureIds: z.array(z.number().int().positive()).max(200).optional(),
    startsOn: day.optional(),
    dueOn: day.nullish(),
  })
  .refine((v) => (v.kind === 'finish_miniatures' ? (v.miniatureIds?.length ?? 0) > 0 : v.target != null), 'Pick miniatures, or set a target');
export const challengePatchSchema = z.object({
  title: text(140).min(1).optional(),
  description: optionalText(1000),
  dueOn: day.nullish(),
  abandoned: z.boolean().optional(),
});
export type ChallengeInput = z.input<typeof challengeInputSchema>;

export interface Challenge {
  id: number;
  title: string;
  description: string | null;
  kind: ChallengeKind;
  group: { id: number; name: string } | null;
  miniatures: { id: number; name: string; status: Status }[];
  startsOn: string;
  dueOn: string | null;
  progress: { current: number; target: number; unit: 'models' | 'hours' | 'days' };
  state: 'active' | 'completed' | 'missed' | 'abandoned';
  /** Days left including today; null without a deadline. */
  daysLeft: number | null;
  completedAt: string | null;
  createdAt: string;
}

export interface Stats {
  /** Last 12 local months, oldest first. */
  months: { month: string; finishedModels: number; paintedSeconds: number }[];
  totals: {
    finishedModels: number;
    paintedSeconds: number;
    sessions: number;
    longestSessionSeconds: number;
    averageSessionSeconds: number;
    photos: number;
    recipesCompleted: number;
  };
  /** Where the hours went. */
  topMiniatures: { id: number; name: string; paintedSeconds: number }[];
}

export const emptyCounts = (): StatusCounts => ({
  unassembled: 0,
  assembled: 0,
  primed: 0,
  in_progress: 0,
  finished: 0,
});
