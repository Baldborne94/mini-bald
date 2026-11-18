import type { FastifyInstance } from 'fastify';
import type { ActivityYear, Insights, PaintStock, Recap } from '@minibald/shared';
import type { Ctx } from '../app.ts';
import { HttpError } from '../lib/http.ts';
import { activityDays, bestStreak, dayStartIso, getAchievements, localDay } from '../services/motivation.ts';

interface PaintRow {
  id: number;
  brand: string;
  range: string;
  name: string;
  type: string | null;
  color_hex: string | null;
  stock: PaintStock;
}
const toRef = (p: PaintRow) => ({ id: p.id, brand: p.brand, range: p.range, name: p.name, type: p.type, colorHex: p.color_hex, stock: p.stock });

/** Small stable hash so "of the day" picks do not change between requests. */
function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
}

export function insightRoutes(app: FastifyInstance, { db }: Ctx) {
  const parseYear = (raw: string | undefined) => {
    const year = raw ? Number(raw) : new Date().getFullYear();
    if (!Number.isInteger(year) || year < 1990 || year > 2200) throw new HttpError(400, 'Invalid year');
    return year;
  };
  const activeYears = (days: Set<string>) => {
    const years = new Set([...days].map((d) => Number(d.slice(0, 4))));
    for (const iso of db.prepare(`SELECT finished_at FROM miniatures WHERE finished_at IS NOT NULL`).pluck().all() as string[]) years.add(new Date(iso).getFullYear());
    years.add(new Date().getFullYear());
    return [...years].sort((a, b) => b - a);
  };
  /** Seconds painted per local day. */
  const secondsByDay = () => {
    const map = new Map<string, number>();
    for (const s of db.prepare('SELECT started_at, duration_sec FROM painting_sessions WHERE duration_sec IS NOT NULL').all() as { started_at: string; duration_sec: number }[]) {
      const day = localDay(new Date(s.started_at));
      map.set(day, (map.get(day) ?? 0) + s.duration_sec);
    }
    return map;
  };

  app.get('/insights', (): Insights => {
    const today = localDay(new Date());
    const usable = db.prepare(`SELECT id, brand, range, name, type, color_hex, stock FROM paints WHERE stock IN ('owned','low') ORDER BY id`).all() as PaintRow[];

    // Colour of the day: prefer paints that have a colour to show.
    const pool = usable.some((p) => p.color_hex) ? usable.filter((p) => p.color_hex) : usable;
    const pick = pool.length > 0 ? pool[hash(today) % pool.length]! : null;
    const uses = pick
      ? (db
          .prepare(
            `SELECT DISTINCT r.id AS recipeId, r.name AS recipeName, m.id AS miniatureId, m.name AS miniatureName
             FROM recipe_steps s JOIN recipes r ON r.id = s.recipe_id LEFT JOIN miniatures m ON m.id = r.miniature_id
             WHERE s.paint_id = ? ORDER BY r.updated_at DESC LIMIT 6`,
          )
          .all(pick.id) as NonNullable<Insights['colourOfDay']>['uses'])
      : [];

    const forgotten = usable.filter((p) => !db.prepare('SELECT 1 FROM recipe_steps WHERE paint_id = ?').get(p.id));
    // A different handful each day, so the same pots are not nagged about forever.
    const sample = [...forgotten].sort((a, b) => hash(`${today}${a.id}`) - hash(`${today}${b.id}`)).slice(0, 8);

    const pile = (db.prepare(`SELECT COALESCE(SUM(quantity), 0) FROM miniatures WHERE status != 'finished'`).pluck().get() as number) ?? 0;
    const since = new Date(Date.now() - 90 * 86_400_000).toISOString();
    const recent = (db.prepare(`SELECT COALESCE(SUM(quantity), 0) FROM miniatures WHERE status = 'finished' AND finished_at >= ?`).pluck().get(since) as number) ?? 0;
    const perDay = recent / 90;
    return {
      colourOfDay: pick ? { paint: toRef(pick), uses } : null,
      forgotten: { count: forgotten.length, sample: sample.map(toRef) },
      pileZero: {
        pile,
        modelsPerMonth: Math.round(perDay * 30.4 * 10) / 10,
        date: pile > 0 && perDay > 0 ? new Date(Date.now() + (pile / perDay) * 86_400_000).toISOString() : null,
      },
    };
  });

  app.get('/activity', (req): ActivityYear => {
    const year = parseYear((req.query as { year?: string }).year);
    const active = activityDays(db);
    const seconds = secondsByDay();
    const today = localDay(new Date());
    const days: ActivityYear['days'] = [];
    for (let d = new Date(year, 0, 1); d.getFullYear() === year; d.setDate(d.getDate() + 1)) {
      const day = localDay(d);
      if (day > today) break;
      days.push({ day, seconds: seconds.get(day) ?? 0, active: active.has(day) });
    }
    return { year, years: activeYears(active), days };
  });

  app.get('/recap', (req): Recap => {
    const year = parseYear((req.query as { year?: string }).year);
    const from = dayStartIso(`${year}-01-01`);
    const to = dayStartIso(`${year + 1}-01-01`);
    const active = activityDays(db);
    const inYear = [...active].filter((d) => d.startsWith(`${year}-`));

    const finished = db
      .prepare(
        `SELECT m.id, m.name, m.quantity, m.finished_at AS finishedAt,
           COALESCE(m.cover_photo_id, (SELECT id FROM photos WHERE miniature_id = m.id ORDER BY taken_at DESC, id DESC LIMIT 1)) AS coverPhotoId
         FROM miniatures m WHERE m.status = 'finished' AND m.finished_at >= ? AND m.finished_at < ? ORDER BY m.finished_at`,
      )
      .all(from, to) as { id: number; name: string; quantity: number; finishedAt: string; coverPhotoId: number | null }[];
    const sessions = db.prepare('SELECT started_at, duration_sec FROM painting_sessions WHERE duration_sec IS NOT NULL AND started_at >= ? AND started_at < ?').all(from, to) as {
      started_at: string;
      duration_sec: number;
    }[];
    const byMonth = new Map<string, number>();
    for (const s of sessions) {
      const month = localDay(new Date(s.started_at)).slice(0, 7);
      byMonth.set(month, (byMonth.get(month) ?? 0) + s.duration_sec);
    }
    const busiest = [...byMonth.entries()].sort((a, b) => b[1] - a[1])[0];

    return {
      year,
      years: activeYears(active),
      finishedModels: finished.reduce((sum, m) => sum + m.quantity, 0),
      finishedCards: finished.length,
      paintedSeconds: sessions.reduce((sum, s) => sum + s.duration_sec, 0),
      sessions: sessions.length,
      longestSessionSeconds: Math.max(0, ...sessions.map((s) => s.duration_sec)),
      daysPainted: inYear.length,
      bestStreak: bestStreak(active, `${year}-01-01`, `${year}-12-31`),
      photosTaken: db.prepare('SELECT COUNT(*) FROM photos WHERE taken_at >= ? AND taken_at < ?').pluck().get(from, to) as number,
      busiestMonth: busiest ? { month: busiest[0], paintedSeconds: busiest[1] } : null,
      topMiniatures: db
        .prepare(
          `SELECT m.id, m.name, SUM(s.duration_sec) AS paintedSeconds FROM painting_sessions s JOIN miniatures m ON m.id = s.miniature_id
           WHERE s.duration_sec IS NOT NULL AND s.started_at >= ? AND s.started_at < ? GROUP BY m.id ORDER BY paintedSeconds DESC LIMIT 3`,
        )
        .all(from, to) as Recap['topMiniatures'],
      // "Used" means a recipe step with that paint was ticked during the year.
      topPaints: db
        .prepare(
          `SELECT s.paint_label AS label, p.color_hex AS colorHex, COUNT(*) AS steps FROM recipe_steps s LEFT JOIN paints p ON p.id = s.paint_id
           WHERE s.done_at >= ? AND s.done_at < ? AND s.paint_label IS NOT NULL GROUP BY s.paint_label ORDER BY steps DESC, label LIMIT 5`,
        )
        .all(from, to) as Recap['topPaints'],
      finished: finished.map(({ quantity: _quantity, ...m }) => m),
      badges: getAchievements(db)
        .filter((a) => a.unlockedAt && a.unlockedAt >= from && a.unlockedAt < to)
        .map((a) => ({ key: a.key, title: a.title, icon: a.icon, paint: a.paint })),
    };
  });
}
