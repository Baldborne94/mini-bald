import type { FastifyInstance } from 'fastify';
import {
  achievementsSeenSchema,
  challengeInputSchema,
  challengePatchSchema,
  type Challenge,
  type ChallengeKind,
  type Stats,
  type Status,
} from '@minibald/shared';
import type { Ctx } from '../app.ts';
import { HttpError, notFound, now, parseId } from '../lib/http.ts';
import { activityDays, bestStreak, dayStartIso, getAchievements, getStreak, localDay } from '../services/motivation.ts';

interface ChallengeRow {
  id: number;
  title: string;
  description: string | null;
  kind: ChallengeKind;
  target: number | null;
  group_id: number | null;
  group_name: string | null;
  starts_on: string;
  due_on: string | null;
  completed_at: string | null;
  abandoned_at: string | null;
  created_at: string;
}

const UNITS = { finish_miniatures: 'models', finish_count: 'models', paint_hours: 'hours', streak_days: 'days' } as const;

export function motivationRoutes(app: FastifyInstance, { db }: Ctx) {
  app.get('/streak', () => getStreak(db));

  app.get('/achievements', () => {
    // Challenges complete when they are measured; measure them first so the badge for
    // winning one unlocks in the same refresh as the action that won it.
    listChallenges();
    return getAchievements(db);
  });

  app.post('/achievements/seen', (req) => {
    const { keys } = achievementsSeenSchema.parse(req.body);
    const mark = db.prepare('UPDATE achievement_unlocks SET seen_at = ? WHERE key = ? AND seen_at IS NULL');
    db.transaction(() => keys.forEach((key) => mark.run(now(), key)))();
    return { ok: true };
  });

  // ---- Challenges ----
  const SELECT = `SELECT c.*, g.name AS group_name FROM challenges c LEFT JOIN groups g ON g.id = c.group_id`;

  /** Progress is measured, not stored: a challenge completes the moment its numbers say so. */
  function toChallenge(row: ChallengeRow, days: Set<string>): Challenge {
    const today = localDay(new Date());
    const from = dayStartIso(row.starts_on);
    // The deadline day is included: the window closes at the start of the day after.
    const until = row.due_on ? dayStartIso(row.due_on, 1) : '9999';
    const miniatures = db
      .prepare(
        `SELECT m.id, m.name, m.status FROM challenge_miniatures cm JOIN miniatures m ON m.id = cm.miniature_id
         WHERE cm.challenge_id = ? ORDER BY m.name COLLATE NOCASE`,
      )
      .all(row.id) as { id: number; name: string; status: Status }[];

    let current = 0;
    let target = row.target ?? 0;
    if (row.kind === 'finish_miniatures') {
      target = miniatures.length;
      current = miniatures.filter((m) => m.status === 'finished').length;
    } else if (row.kind === 'finish_count') {
      current = db
        .prepare(
          `SELECT COALESCE(SUM(quantity), 0) FROM miniatures WHERE status = 'finished' AND finished_at >= ? AND finished_at < ?
           ${row.group_id ? 'AND group_id IN (SELECT id FROM groups WHERE id = ? OR parent_id = ?)' : ''}`,
        )
        .pluck()
        .get(...[from, until, ...(row.group_id ? [row.group_id, row.group_id] : [])]) as number;
    } else if (row.kind === 'paint_hours') {
      const seconds = db.prepare('SELECT COALESCE(SUM(duration_sec), 0) FROM painting_sessions WHERE started_at >= ? AND started_at < ?').pluck().get(from, until) as number;
      current = Math.floor(seconds / 360) / 10; // one decimal
    } else {
      current = bestStreak(days, row.starts_on, row.due_on ?? undefined);
    }

    let completedAt = row.completed_at;
    if (!completedAt && !row.abandoned_at && target > 0 && current >= target) {
      completedAt = now();
      db.prepare('UPDATE challenges SET completed_at = ? WHERE id = ?').run(completedAt, row.id);
    }
    const state = row.abandoned_at ? 'abandoned' : completedAt ? 'completed' : row.due_on && today > row.due_on ? 'missed' : 'active';
    const daysLeft = row.due_on ? Math.round((Date.parse(row.due_on) - Date.parse(today)) / 86_400_000) + 1 : null;
    return {
      id: row.id,
      title: row.title,
      description: row.description,
      kind: row.kind,
      group: row.group_id ? { id: row.group_id, name: row.group_name! } : null,
      miniatures,
      startsOn: row.starts_on,
      dueOn: row.due_on,
      progress: { current: completedAt ? Math.max(current, target) : current, target, unit: UNITS[row.kind] },
      state,
      daysLeft: state === 'active' ? daysLeft : null,
      completedAt,
      createdAt: row.created_at,
    };
  }

  const getChallenge = (id: number) => {
    const row = db.prepare(`${SELECT} WHERE c.id = ?`).get(id) as ChallengeRow | undefined;
    return row && toChallenge(row, activityDays(db));
  };

  function listChallenges(): Challenge[] {
    const days = activityDays(db);
    const order = { active: 0, completed: 1, missed: 2, abandoned: 3 };
    return (db.prepare(`${SELECT} ORDER BY c.created_at DESC, c.id DESC`).all() as ChallengeRow[])
      .map((row) => toChallenge(row, days))
      .sort((a, b) => order[a.state] - order[b.state]);
  }

  app.get('/challenges', listChallenges);

  app.post('/challenges', (req, reply) => {
    const input = challengeInputSchema.parse(req.body);
    if (input.groupId != null && !db.prepare('SELECT 1 FROM groups WHERE id = ?').get(input.groupId)) throw new HttpError(400, 'Group does not exist');
    const startsOn = input.startsOn ?? localDay(new Date());
    if (input.dueOn && input.dueOn < startsOn) throw new HttpError(400, 'The deadline is before the start date');
    const id = db.transaction(() => {
      const newId = Number(
        db
          .prepare('INSERT INTO challenges (title, description, kind, target, group_id, starts_on, due_on, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
          .run(input.title, input.description ?? null, input.kind, input.kind === 'finish_miniatures' ? null : input.target, input.kind === 'finish_count' ? (input.groupId ?? null) : null, startsOn, input.dueOn ?? null, now())
          .lastInsertRowid,
      );
      if (input.kind === 'finish_miniatures') {
        const link = db.prepare('INSERT OR IGNORE INTO challenge_miniatures (challenge_id, miniature_id) SELECT ?, id FROM miniatures WHERE id = ?');
        for (const miniId of input.miniatureIds ?? []) link.run(newId, miniId);
        if (!db.prepare('SELECT 1 FROM challenge_miniatures WHERE challenge_id = ?').get(newId)) throw new HttpError(400, 'None of the chosen miniatures exist');
      }
      return newId;
    })();
    reply.code(201);
    return getChallenge(id);
  });

  app.patch('/challenges/:id', (req) => {
    const id = parseId((req.params as { id: string }).id);
    const input = challengePatchSchema.parse(req.body);
    const row = db.prepare('SELECT * FROM challenges WHERE id = ?').get(id) as ChallengeRow | undefined;
    if (!row) throw notFound('Challenge');
    db.prepare('UPDATE challenges SET title = ?, description = ?, due_on = ?, abandoned_at = ? WHERE id = ?').run(
      input.title ?? row.title,
      input.description === undefined ? row.description : input.description,
      input.dueOn === undefined ? row.due_on : input.dueOn,
      input.abandoned === undefined ? row.abandoned_at : input.abandoned ? (row.abandoned_at ?? now()) : null,
      id,
    );
    return getChallenge(id);
  });

  app.delete('/challenges/:id', (req, reply) => {
    db.prepare('DELETE FROM challenges WHERE id = ?').run(parseId((req.params as { id: string }).id));
    return reply.code(204).send();
  });

  // ---- Statistics ----
  app.get('/stats', (): Stats => {
    const today = new Date();
    const months = Array.from({ length: 12 }, (_, i) => {
      const d = new Date(today.getFullYear(), today.getMonth() - 11 + i, 1);
      return { month: localDay(d).slice(0, 7), finishedModels: 0, paintedSeconds: 0 };
    });
    const byMonth = new Map(months.map((m) => [m.month, m]));
    const monthOf = (iso: string) => byMonth.get(localDay(new Date(iso)).slice(0, 7));

    for (const m of db.prepare(`SELECT finished_at, quantity FROM miniatures WHERE status = 'finished' AND finished_at IS NOT NULL`).all() as { finished_at: string; quantity: number }[]) {
      const bucket = monthOf(m.finished_at);
      if (bucket) bucket.finishedModels += m.quantity;
    }
    const sessions = db.prepare('SELECT started_at, duration_sec FROM painting_sessions WHERE duration_sec IS NOT NULL').all() as { started_at: string; duration_sec: number }[];
    for (const s of sessions) {
      const bucket = monthOf(s.started_at);
      if (bucket) bucket.paintedSeconds += s.duration_sec;
    }
    const paintedSeconds = sessions.reduce((sum, s) => sum + s.duration_sec, 0);
    const count = (sql: string) => (db.prepare(sql).pluck().get() as number | null) ?? 0;
    return {
      months,
      totals: {
        finishedModels: count(`SELECT SUM(quantity) FROM miniatures WHERE status = 'finished'`),
        paintedSeconds,
        sessions: sessions.length,
        longestSessionSeconds: Math.max(0, ...sessions.map((s) => s.duration_sec)),
        averageSessionSeconds: sessions.length > 0 ? Math.round(paintedSeconds / sessions.length) : 0,
        photos: count('SELECT COUNT(*) FROM photos'),
        recipesCompleted: count(`SELECT COUNT(*) FROM recipes r WHERE r.miniature_id IS NOT NULL
          AND EXISTS (SELECT 1 FROM recipe_steps s WHERE s.recipe_id = r.id)
          AND NOT EXISTS (SELECT 1 FROM recipe_steps s WHERE s.recipe_id = r.id AND s.done_at IS NULL)`),
      },
      topMiniatures: db
        .prepare(
          `SELECT m.id, m.name, SUM(s.duration_sec) AS paintedSeconds FROM painting_sessions s JOIN miniatures m ON m.id = s.miniature_id
           WHERE s.duration_sec IS NOT NULL GROUP BY m.id ORDER BY paintedSeconds DESC LIMIT 5`,
        )
        .all() as Stats['topMiniatures'],
    };
  });
}
