import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import type { Config } from '../config.ts';
import { migrate } from './migrate.ts';

export type Db = Database.Database;

export function openDatabase(config: Config): Db {
  for (const dir of ['photos', 'cache/thumbs', 'backups', 'trash', 'catalogs']) {
    fs.mkdirSync(path.join(config.dataDir, dir), { recursive: true });
  }
  const dbPath = path.join(config.dataDir, 'minis.db');
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  migrate(db, config.migrationsDir, dbPath, path.join(config.dataDir, 'backups'));
  return db;
}
