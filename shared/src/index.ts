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

export const emptyCounts = (): StatusCounts => ({
  unassembled: 0,
  assembled: 0,
  primed: 0,
  in_progress: 0,
  finished: 0,
});
