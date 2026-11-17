import type { Achievement, Streak } from '@minibald/shared';
import type { Db } from '../db/connection.ts';
import { now } from '../lib/http.ts';

// Everything here is derived from what the app already records. "Days" are local calendar
// days in the server's time zone (TZ), written YYYY-MM-DD.

const pad = (n: number) => String(n).padStart(2, '0');
export const localDay = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const dayNumber = (day: string) => Math.round(Date.UTC(Number(day.slice(0, 4)), Number(day.slice(5, 7)) - 1, Number(day.slice(8, 10))) / 86_400_000);
const dayFromNumber = (n: number) => new Date(n * 86_400_000).toISOString().slice(0, 10);
/** Start of a local day as a UTC timestamp, for comparing with stored ISO dates. */
export const dayStartIso = (day: string, offsetDays = 0) =>
  new Date(Number(day.slice(0, 4)), Number(day.slice(5, 7)) - 1, Number(day.slice(8, 10)) + offsetDays).toISOString();

/**
 * A day counts as a painting day if a session of at least a minute started on it, a recipe
 * step was ticked, or a miniature moved to "in progress" or "finished".
 */
export function activityDays(db: Db): Set<string> {
  const stamps = [
    ...(db.prepare('SELECT started_at FROM painting_sessions WHERE ended_at IS NULL OR duration_sec >= 60').pluck().all() as string[]),
    ...(db.prepare('SELECT done_at FROM recipe_steps WHERE done_at IS NOT NULL').pluck().all() as string[]),
    ...(db
      .prepare(`SELECT changed_at FROM status_events WHERE from_status IS NOT NULL AND to_status IN ('in_progress','finished')`)
      .pluck()
      .all() as string[]),
  ];
  return new Set(stamps.map((s) => localDay(new Date(s))));
}

/** Longest run of consecutive days, optionally limited to an inclusive range. */
export function bestStreak(days: Set<string>, from?: string, to?: string): number {
  const numbers = [...days].filter((d) => (!from || d >= from) && (!to || d <= to)).map(dayNumber).sort((a, b) => a - b);
  let best = 0;
  let run = 0;
  numbers.forEach((n, i) => {
    run = i > 0 && n === numbers[i - 1]! + 1 ? run + 1 : 1;
    best = Math.max(best, run);
  });
  return best;
}

export function getStreak(db: Db, today = localDay(new Date())): Streak {
  const days = activityDays(db);
  const todayN = dayNumber(today);
  const paintedToday = days.has(today);
  // Today not painted yet does not break the streak: it is still alive until midnight.
  let current = 0;
  for (let n = paintedToday ? todayN : todayN - 1; days.has(dayFromNumber(n)); n--) current++;
  return {
    current,
    best: bestStreak(days),
    paintedToday,
    recent: Array.from({ length: 14 }, (_, i) => {
      const day = dayFromNumber(todayN - 13 + i);
      return { day, active: days.has(day) };
    }),
  };
}

interface Facts {
  finishedCards: number;
  finishedModels: number;
  totalModels: number;
  bestMonth: number;
  groupsComplete: number;
  bestStreak: number;
  hours: number;
  longestSessionHours: number;
  recipesCompleted: number;
  photos: number;
  beforeAfter: number;
  paints: number;
  challengesWon: number;
  quickFinishes: number;
}

function gatherFacts(db: Db): Facts {
  const one = <T>(sql: string) => db.prepare(sql).get() as T;
  const count = (sql: string) => (db.prepare(sql).pluck().get() as number | null) ?? 0;
  const finished = one<{ cards: number; models: number }>(`SELECT COUNT(*) AS cards, COALESCE(SUM(quantity), 0) AS models FROM miniatures WHERE status = 'finished'`);
  const byMonth = new Map<string, number>();
  for (const row of db.prepare(`SELECT finished_at, quantity FROM miniatures WHERE status = 'finished' AND finished_at IS NOT NULL`).all() as { finished_at: string; quantity: number }[]) {
    const month = localDay(new Date(row.finished_at)).slice(0, 7);
    byMonth.set(month, (byMonth.get(month) ?? 0) + row.quantity);
  }
  const sessions = one<{ total: number; longest: number }>('SELECT COALESCE(SUM(duration_sec), 0) AS total, COALESCE(MAX(duration_sec), 0) AS longest FROM painting_sessions');
  return {
    finishedCards: finished.cards,
    finishedModels: finished.models,
    totalModels: count('SELECT SUM(quantity) FROM miniatures'),
    bestMonth: Math.max(0, ...byMonth.values()),
    // A top-level group counts with its sub-groups, and needs at least three models to be a real feat.
    groupsComplete: count(`SELECT COUNT(*) FROM (
      SELECT COALESCE((SELECT parent_id FROM groups WHERE id = m.group_id), m.group_id) AS g,
             SUM(quantity) AS total, SUM(CASE WHEN status = 'finished' THEN quantity ELSE 0 END) AS done
      FROM miniatures m WHERE group_id IS NOT NULL GROUP BY g HAVING total >= 3 AND total = done)`),
    bestStreak: bestStreak(activityDays(db)),
    hours: sessions.total / 3600,
    longestSessionHours: sessions.longest / 3600,
    recipesCompleted: count(`SELECT COUNT(*) FROM recipes r WHERE r.miniature_id IS NOT NULL
      AND EXISTS (SELECT 1 FROM recipe_steps s WHERE s.recipe_id = r.id)
      AND NOT EXISTS (SELECT 1 FROM recipe_steps s WHERE s.recipe_id = r.id AND s.done_at IS NULL)`),
    photos: count('SELECT COUNT(*) FROM photos'),
    beforeAfter: count(`SELECT COUNT(*) FROM miniatures m
      WHERE EXISTS (SELECT 1 FROM photos p WHERE p.miniature_id = m.id AND p.stage IN ('unassembled','assembled','primed'))
        AND EXISTS (SELECT 1 FROM photos p WHERE p.miniature_id = m.id AND p.stage = 'finished')`),
    paints: count(`SELECT COUNT(*) FROM paints WHERE stock IN ('owned','low')`),
    challengesWon: count('SELECT COUNT(*) FROM challenges WHERE completed_at IS NOT NULL'),
    quickFinishes: count(`SELECT COUNT(*) FROM miniatures WHERE status = 'finished' AND started_at IS NOT NULL
      AND julianday(finished_at) - julianday(started_at) <= 7`),
  };
}

interface Definition {
  key: string;
  title: string;
  description: string;
  icon: string;
  paint: number;
  target: number;
  current: (f: Facts) => number;
}

// To add a badge, add a line: it unlocks by itself the next time achievements are read.
const DEFINITIONS: Definition[] = [
  { key: 'first_finished', title: 'First of many', description: 'Finish your first miniature.', icon: 'check', paint: 5, target: 1, current: (f) => f.finishedCards },
  { key: 'finished_10', title: 'Squad ready', description: 'Finish 10 models.', icon: 'star', paint: 2, target: 10, current: (f) => f.finishedModels },
  { key: 'finished_50', title: 'Battle line', description: 'Finish 50 models.', icon: 'star', paint: 1, target: 50, current: (f) => f.finishedModels },
  { key: 'finished_100', title: 'Century', description: 'Finish 100 models.', icon: 'trophy', paint: 3, target: 100, current: (f) => f.finishedModels },
  { key: 'ten_in_month', title: 'On a roll', description: 'Finish 10 models in one calendar month.', icon: 'flame', paint: 6, target: 10, current: (f) => f.bestMonth },
  { key: 'group_complete', title: 'Fully painted', description: 'Finish every model in a group of three or more.', icon: 'folder', paint: 4, target: 1, current: (f) => f.groupsComplete },
  { key: 'pile_halved', title: 'Halfway there', description: 'Have half of a collection of 10 or more models painted.', icon: 'target', paint: 2, target: 50, current: (f) => (f.totalModels >= 10 ? Math.floor((f.finishedModels / f.totalModels) * 100) : 0) },
  { key: 'pile_zero', title: 'No shame', description: 'Paint every model of a collection of 10 or more.', icon: 'trophy', paint: 5, target: 100, current: (f) => (f.totalModels >= 10 ? Math.floor((f.finishedModels / f.totalModels) * 100) : 0) },
  { key: 'streak_3', title: 'Warming up', description: 'Paint three days in a row.', icon: 'flame', paint: 3, target: 3, current: (f) => f.bestStreak },
  { key: 'streak_7', title: 'A full week', description: 'Paint seven days in a row.', icon: 'flame', paint: 6, target: 7, current: (f) => f.bestStreak },
  { key: 'streak_30', title: 'Habit formed', description: 'Paint thirty days in a row.', icon: 'flame', paint: 1, target: 30, current: (f) => f.bestStreak },
  { key: 'hours_10', title: 'Ten hours in', description: 'Log 10 hours at the brush.', icon: 'clock', paint: 4, target: 10, current: (f) => Math.floor(f.hours) },
  { key: 'hours_50', title: 'Steady hand', description: 'Log 50 hours at the brush.', icon: 'clock', paint: 2, target: 50, current: (f) => Math.floor(f.hours) },
  { key: 'hours_100', title: 'Hundred-hour brush', description: 'Log 100 hours at the brush.', icon: 'clock', paint: 1, target: 100, current: (f) => Math.floor(f.hours) },
  { key: 'marathon', title: 'In the zone', description: 'Paint for three hours in a single session.', icon: 'play', paint: 6, target: 3, current: (f) => Math.floor(f.longestSessionHours) },
  { key: 'quick_finish', title: 'Quick brush', description: 'Finish a miniature within a week of starting it.', icon: 'arrow', paint: 3, target: 1, current: (f) => f.quickFinishes },
  { key: 'recipe_done', title: 'By the book', description: 'Tick off every step of a recipe.', icon: 'book', paint: 4, target: 1, current: (f) => f.recipesCompleted },
  { key: 'before_after', title: 'Glow up', description: 'Photograph a miniature before painting and again when finished.', icon: 'compare', paint: 2, target: 1, current: (f) => f.beforeAfter },
  { key: 'photos_25', title: 'Bench photographer', description: 'Take 25 photos.', icon: 'camera', paint: 5, target: 25, current: (f) => f.photos },
  { key: 'paints_50', title: 'Paint rack', description: 'Have 50 paints in your inventory.', icon: 'drop', paint: 1, target: 50, current: (f) => f.paints },
  { key: 'challenge_won', title: 'Promise kept', description: 'Complete a personal challenge.', icon: 'target', paint: 6, target: 1, current: (f) => f.challengesWon },
];

/**
 * Reads the badges, unlocking any that have just been earned. Evaluation happens on read:
 * the client refetches after every change, so nothing has to remember to "award" a badge.
 * A badge, once unlocked, stays unlocked.
 */
export function getAchievements(db: Db): Achievement[] {
  const facts = gatherFacts(db);
  const unlocked = new Map(
    (db.prepare('SELECT key, unlocked_at, seen_at FROM achievement_unlocks').all() as { key: string; unlocked_at: string; seen_at: string | null }[]).map((r) => [r.key, r]),
  );
  const insert = db.prepare('INSERT OR IGNORE INTO achievement_unlocks (key, unlocked_at) VALUES (?, ?)');
  return DEFINITIONS.map((def) => {
    const current = def.current(facts);
    let row = unlocked.get(def.key);
    if (!row && current >= def.target) {
      row = { key: def.key, unlocked_at: now(), seen_at: null };
      insert.run(def.key, row.unlocked_at);
    }
    return {
      key: def.key,
      title: def.title,
      description: def.description,
      icon: def.icon,
      paint: def.paint,
      unlockedAt: row?.unlocked_at ?? null,
      seen: row ? row.seen_at !== null : true,
      progress: { current: row ? def.target : Math.min(current, def.target), target: def.target },
    };
  });
}
