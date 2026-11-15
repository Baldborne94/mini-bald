import type { FastifyInstance } from 'fastify';
import {
  sessionInputSchema,
  sessionPatchSchema,
  sessionStartSchema,
  sessionStopSchema,
  type PaintingSession,
} from '@minibald/shared';
import type { Ctx } from '../app.ts';
import type { Db } from '../db/connection.ts';
import { HttpError, notFound, now, parseId } from '../lib/http.ts';
import { touch } from '../services/miniatures.ts';

interface SessionRow {
  id: number;
  miniature_id: number | null;
  miniature_name: string | null;
  started_at: string;
  ended_at: string | null;
  duration_sec: number | null;
  notes: string | null;
}

const SELECT = `SELECT s.*, m.name AS miniature_name FROM painting_sessions s LEFT JOIN miniatures m ON m.id = s.miniature_id`;

const toSession = (r: SessionRow): PaintingSession => ({
  id: r.id,
  miniatureId: r.miniature_id,
  miniatureName: r.miniature_name,
  startedAt: r.started_at,
  endedAt: r.ended_at,
  durationSec: r.duration_sec,
  notes: r.notes,
});

const seconds = (from: string, to: string) => Math.max(1, Math.round((Date.parse(to) - Date.parse(from)) / 1000));

/** The timer lives in the database, so it survives a closed tab and shows on every device. */
function stopRunning(db: Db, notes?: string | null): number | null {
  const running = db.prepare('SELECT id, started_at, notes FROM painting_sessions WHERE ended_at IS NULL').get() as
    | { id: number; started_at: string; notes: string | null }
    | undefined;
  if (!running) return null;
  const ended = now();
  db.prepare('UPDATE painting_sessions SET ended_at = ?, duration_sec = ?, notes = ? WHERE id = ?').run(
    ended,
    seconds(running.started_at, ended),
    notes ?? running.notes,
    running.id,
  );
  return running.id;
}

export function sessionRoutes(app: FastifyInstance, { db }: Ctx) {
  const get = (id: number) => {
    const row = db.prepare(`${SELECT} WHERE s.id = ?`).get(id) as SessionRow | undefined;
    return row && toSession(row);
  };
  const checkMini = (id: number | null | undefined) => {
    if (id != null && !db.prepare('SELECT 1 FROM miniatures WHERE id = ?').get(id)) throw new HttpError(400, 'Miniature does not exist');
  };

  app.get('/sessions', (req) => {
    const query = req.query as { miniature?: string; limit?: string };
    const limit = Math.min(Math.max(Number(query.limit) || 100, 1), 500);
    const rows = (
      query.miniature
        ? db.prepare(`${SELECT} WHERE s.miniature_id = ? ORDER BY s.started_at DESC LIMIT ?`).all(parseId(query.miniature), limit)
        : db.prepare(`${SELECT} ORDER BY s.started_at DESC LIMIT ?`).all(limit)
    ) as SessionRow[];
    return rows.map(toSession);
  });

  app.get('/sessions/active', () => {
    const row = db.prepare(`${SELECT} WHERE s.ended_at IS NULL`).get() as SessionRow | undefined;
    return { session: row ? toSession(row) : null };
  });

  // Starting a timer stops whichever one is running: you only paint one thing at a time.
  app.post('/sessions/start', (req, reply) => {
    const { miniatureId } = sessionStartSchema.parse(req.body ?? {});
    checkMini(miniatureId);
    const id = db.transaction(() => {
      stopRunning(db);
      if (miniatureId != null) touch(db, miniatureId);
      return Number(
        db.prepare('INSERT INTO painting_sessions (miniature_id, started_at) VALUES (?, ?)').run(miniatureId ?? null, now()).lastInsertRowid,
      );
    })();
    reply.code(201);
    return get(id);
  });

  app.post('/sessions/stop', (req) => {
    const { notes } = sessionStopSchema.parse(req.body ?? {});
    const id = db.transaction(() => stopRunning(db, notes))();
    return { session: id === null ? null : get(id) };
  });

  // Log a session after the fact (forgot to start the timer).
  app.post('/sessions', (req, reply) => {
    const input = sessionInputSchema.parse(req.body);
    checkMini(input.miniatureId);
    const id = Number(
      db
        .prepare('INSERT INTO painting_sessions (miniature_id, started_at, ended_at, duration_sec, notes) VALUES (?, ?, ?, ?, ?)')
        .run(input.miniatureId ?? null, input.startedAt, input.endedAt, seconds(input.startedAt, input.endedAt), input.notes ?? null)
        .lastInsertRowid,
    );
    reply.code(201);
    return get(id);
  });

  app.patch('/sessions/:id', (req) => {
    const id = parseId((req.params as { id: string }).id);
    const input = sessionPatchSchema.parse(req.body);
    const current = get(id);
    if (!current) throw notFound('Session');
    if (input.durationSec !== undefined && current.endedAt === null) throw new HttpError(409, 'Stop the timer before editing its duration');
    const duration = input.durationSec ?? current.durationSec;
    db.prepare('UPDATE painting_sessions SET notes = ?, duration_sec = ?, ended_at = ? WHERE id = ?').run(
      input.notes === undefined ? current.notes : input.notes,
      duration,
      input.durationSec !== undefined ? new Date(Date.parse(current.startedAt) + input.durationSec * 1000).toISOString() : current.endedAt,
      id,
    );
    return get(id);
  });

  app.delete('/sessions/:id', (req, reply) => {
    db.prepare('DELETE FROM painting_sessions WHERE id = ?').run(parseId((req.params as { id: string }).id));
    return reply.code(204).send();
  });
}
