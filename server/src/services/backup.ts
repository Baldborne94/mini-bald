import fs from 'node:fs';
import path from 'node:path';
import type { FastifyBaseLogger } from 'fastify';
import type { Config } from '../config.ts';
import type { Db } from '../db/connection.ts';
import { localDay } from './motivation.ts';

/** A consistent copy of the live database (SQLite's online backup), safe while the app is in use. */
export async function snapshot(db: Db, dest: string): Promise<void> {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.rmSync(dest, { force: true });
  await db.backup(dest);
}

export const autoDir = (config: Config) => path.join(config.dataDir, 'backups', 'auto');

export function listAutoBackups(config: Config) {
  const dir = autoDir(config);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => /^minis_\d{4}-\d{2}-\d{2}\.db$/.test(f))
    .sort()
    .reverse()
    .map((name) => ({ name, bytes: fs.statSync(path.join(dir, name)).size, day: name.slice(6, 16) }));
}

/**
 * One database snapshot per day in data/backups/auto, keeping the newest `backupKeep`.
 * Photos are plain files and are not duplicated here: the full backup download, or the
 * NAS's own snapshots, cover those.
 */
export function startAutoBackups(db: Db, config: Config, log: FastifyBaseLogger): () => Promise<void> {
  if (config.backupKeep <= 0) return async () => {};
  let running: Promise<void> = Promise.resolve();
  const run = () => {
    running = (async () => {
      const today = path.join(autoDir(config), `minis_${localDay(new Date())}.db`);
      if (!fs.existsSync(today)) {
        await snapshot(db, today);
        log.info(`Daily database backup written: ${today}`);
      }
      for (const old of listAutoBackups(config).slice(config.backupKeep)) fs.rmSync(path.join(autoDir(config), old.name), { force: true });
    })().catch((err) => log.error(err, 'Automatic backup failed'));
  };
  run();
  const timer = setInterval(run, 60 * 60 * 1000);
  timer.unref();
  return async () => {
    clearInterval(timer);
    await running;
  };
}

/** Every file under `dir`, as paths relative to it. */
export function walk(dir: string, prefix = ''): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const rel = path.posix.join(prefix, entry.name);
    return entry.isDirectory() ? walk(path.join(dir, entry.name), rel) : entry.isFile() ? [rel] : [];
  });
}
