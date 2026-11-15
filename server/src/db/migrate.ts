import fs from 'node:fs';
import path from 'node:path';
import type { Database } from 'better-sqlite3';

const FILE_PATTERN = /^(\d+)_(.+)\.sql$/;

/**
 * Forward-only migrations: numbered .sql files, each applied once in its own transaction.
 * Before touching an existing database, a copy is saved to `backupDir`.
 */
export function migrate(db: Database, migrationsDir: string, dbPath: string, backupDir: string): number[] {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version    INTEGER PRIMARY KEY,
    name       TEXT NOT NULL,
    applied_at TEXT NOT NULL
  )`);

  const applied = new Set(db.prepare('SELECT version FROM schema_migrations').pluck().all() as number[]);
  const pending = fs
    .readdirSync(migrationsDir)
    .map((file) => ({ file, match: FILE_PATTERN.exec(file) }))
    .filter((m): m is { file: string; match: RegExpExecArray } => m.match !== null)
    .map(({ file, match }) => ({ file, version: Number(match[1]), name: match[2]! }))
    .sort((a, b) => a.version - b.version)
    .filter((m) => !applied.has(m.version));

  if (pending.length === 0) return [];

  if (applied.size > 0) {
    db.pragma('wal_checkpoint(TRUNCATE)');
    fs.mkdirSync(backupDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    fs.copyFileSync(dbPath, path.join(backupDir, `minis_before_${pending[0]!.file.replace('.sql', '')}_${stamp}.db`));
  }

  const record = db.prepare('INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)');
  for (const m of pending) {
    const sql = fs.readFileSync(path.join(migrationsDir, m.file), 'utf8');
    db.transaction(() => {
      db.exec(sql);
      record.run(m.version, m.name, new Date().toISOString());
    })();
  }
  return pending.map((m) => m.version);
}

export function schemaVersion(db: Database): number {
  return (db.prepare('SELECT COALESCE(MAX(version), 0) FROM schema_migrations').pluck().get() as number) ?? 0;
}
