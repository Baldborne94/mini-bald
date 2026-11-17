import fs from 'node:fs';
import path from 'node:path';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import yazl from 'yazl';
import { STATUS_LABELS, pinChangeSchema, pinUnlockSchema, type AuthStatus, type BackupInfo, type Status } from '@minibald/shared';
import type { Ctx } from '../app.ts';
import { HttpError } from '../lib/http.ts';
import { COOKIE, SESSION_DAYS, Throttle, issueToken, pinEnabled, readCookie, setPin, validToken, verifyPin } from '../services/auth.ts';
import { listAutoBackups, snapshot, walk } from '../services/backup.ts';
import { localDay } from '../services/motivation.ts';

/** PIN lock, backups and exports. */
export function systemRoutes(app: FastifyInstance, { db, config }: Ctx) {
  const throttle = new Throttle();
  const unlocked = (req: FastifyRequest) => !pinEnabled(db) || validToken(db, readCookie(req.headers.cookie, COOKIE));

  const setCookie = (req: FastifyRequest, reply: FastifyReply, token: string | null) =>
    reply.header(
      'Set-Cookie',
      [
        `${COOKIE}=${token ?? ''}`,
        'Path=/',
        'HttpOnly',
        'SameSite=Lax',
        `Max-Age=${token ? SESSION_DAYS * 86_400 : 0}`,
        // Only marked Secure over HTTPS, so the lock also works on a plain-HTTP home network.
        ...(req.protocol === 'https' ? ['Secure'] : []),
      ].join('; '),
    );

  // Everything under /api needs an unlocked session once a PIN is set, photos included.
  // Health and the auth endpoints stay open so the lock screen can work.
  app.addHook('onRequest', async (req) => {
    const url = req.url.split('?')[0]!;
    if (url === '/api/health' || url.startsWith('/api/auth/')) return;
    if (!unlocked(req)) throw new HttpError(401, 'Locked. Enter the PIN.');
  });

  app.get('/auth/status', (req): AuthStatus => ({ pinEnabled: pinEnabled(db), unlocked: unlocked(req) }));

  app.post('/auth/unlock', (req, reply) => {
    const { pin } = pinUnlockSchema.parse(req.body);
    const wait = throttle.retryAfterSeconds();
    if (wait > 0) {
      reply.header('Retry-After', wait);
      throw new HttpError(429, `Too many wrong attempts. Try again in ${wait} seconds.`);
    }
    if (!verifyPin(db, pin)) {
      throttle.fail();
      throw new HttpError(401, 'Wrong PIN.');
    }
    throttle.reset();
    setCookie(req, reply, issueToken(db));
    return { ok: true };
  });

  app.post('/auth/lock', (req, reply) => {
    setCookie(req, reply, null);
    return { ok: true };
  });

  // Set, change or remove the PIN. Changing it needs the current one even on an unlocked device.
  app.put('/auth/pin', (req, reply) => {
    const { currentPin, newPin } = pinChangeSchema.parse(req.body);
    if (pinEnabled(db)) {
      if (!unlocked(req)) throw new HttpError(401, 'Locked. Enter the PIN.');
      if (throttle.retryAfterSeconds() > 0) throw new HttpError(429, 'Too many wrong attempts. Try again later.');
      if (!currentPin || !verifyPin(db, currentPin)) {
        throttle.fail();
        throw new HttpError(403, 'The current PIN is wrong.');
      }
      throttle.reset();
    }
    setPin(db, newPin);
    // The secret rotated, which signed every device out; keep this one in.
    setCookie(req, reply, newPin === null ? null : issueToken(db));
    return { pinEnabled: newPin !== null };
  });

  // ---- Backups ----
  const stamp = () => localDay(new Date());
  const tmpDir = path.join(config.dataDir, 'backups', 'tmp');
  const tmpSnapshot = async () => {
    const file = path.join(tmpDir, `snapshot_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.db`);
    await snapshot(db, file);
    return file;
  };

  app.get('/backup', (): BackupInfo => ({
    databaseBytes: fs.statSync(path.join(config.dataDir, 'minis.db')).size,
    photos: db.prepare('SELECT COUNT(*) AS count, COALESCE(SUM(bytes), 0) AS bytes FROM photos').get() as BackupInfo['photos'],
    keep: config.backupKeep,
    automatic: listAutoBackups(config),
  }));

  app.get('/backup/database', async (_req, reply) => {
    const file = await tmpSnapshot();
    const stream = fs.createReadStream(file);
    stream.on('close', () => fs.rmSync(file, { force: true }));
    return reply
      .header('Content-Disposition', `attachment; filename="minibald-${stamp()}.db"`)
      .header('Content-Length', fs.statSync(file).size)
      .type('application/vnd.sqlite3')
      .send(stream);
  });

  // The whole data folder that matters, as one zip: unzip it into an empty folder to restore.
  app.get('/backup/full', async (_req, reply) => {
    const dbFile = await tmpSnapshot();
    const zip = new yazl.ZipFile();
    zip.addFile(dbFile, 'minis.db');
    // Photos are already compressed; storing them as they are keeps the download fast.
    for (const rel of walk(path.join(config.dataDir, 'photos'))) zip.addFile(path.join(config.dataDir, 'photos', rel), `photos/${rel}`, { compress: false });
    for (const rel of walk(path.join(config.dataDir, 'catalogs'))) zip.addFile(path.join(config.dataDir, 'catalogs', rel), `catalogs/${rel}`);
    zip.end();
    zip.outputStream.on('close', () => fs.rmSync(dbFile, { force: true }));
    zip.outputStream.on('end', () => fs.rmSync(dbFile, { force: true }));
    return reply
      .header('Content-Disposition', `attachment; filename="minibald-backup-${stamp()}.zip"`)
      .type('application/zip')
      .send(zip.outputStream);
  });

  app.get('/miniatures/export.csv', (_req, reply) => {
    const rows = db
      .prepare(
        `SELECT m.name, g.name AS grp, m.status, m.quantity,
           (SELECT GROUP_CONCAT(t.name, '; ') FROM miniature_tags mt JOIN tags t ON t.id = mt.tag_id WHERE mt.miniature_id = m.id) AS tags,
           m.acquired_on, m.started_at, m.finished_at,
           (SELECT COALESCE(SUM(duration_sec), 0) FROM painting_sessions s WHERE s.miniature_id = m.id) AS seconds,
           (SELECT COUNT(*) FROM photos p WHERE p.miniature_id = m.id) AS photos,
           m.description, m.notes
         FROM miniatures m LEFT JOIN groups g ON g.id = m.group_id ORDER BY g.name COLLATE NOCASE, m.name COLLATE NOCASE`,
      )
      .all() as Record<string, string | number | null>[];
    const cell = (v: string | number | null) => (v === null ? '' : /[",\n\r]/.test(String(v)) ? `"${String(v).replaceAll('"', '""')}"` : String(v));
    const header = ['name', 'group', 'status', 'models', 'tags', 'acquired', 'started', 'finished', 'hours_painted', 'photos', 'description', 'notes'];
    const lines = rows.map((r) =>
      [r.name, r.grp, STATUS_LABELS[r.status as Status], r.quantity, r.tags, r.acquired_on, r.started_at, r.finished_at, (Number(r.seconds) / 3600).toFixed(1), r.photos, r.description, r.notes]
        .map((v) => cell(v as string | number | null))
        .join(','),
    );
    return reply
      .type('text/csv; charset=utf-8')
      .header('Content-Disposition', `attachment; filename="minibald-miniatures-${stamp()}.csv"`)
      .send(`﻿${[header.join(','), ...lines].join('\r\n')}\r\n`);
  });
}
