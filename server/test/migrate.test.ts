import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import Database from 'better-sqlite3';
import { migrate, schemaVersion } from '../src/db/migrate.ts';

const real = path.resolve(import.meta.dirname, '../migrations');

function workspace() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'minibald-migrate-'));
  const migrations = path.join(dir, 'migrations');
  fs.mkdirSync(migrations);
  return { dir, migrations, dbPath: path.join(dir, 'minis.db'), backups: path.join(dir, 'backups') };
}

test('a new database gets every migration, and running again changes nothing', () => {
  const w = workspace();
  for (const f of fs.readdirSync(real)) fs.copyFileSync(path.join(real, f), path.join(w.migrations, f));
  const db = new Database(w.dbPath);
  const applied = migrate(db, w.migrations, w.dbPath, w.backups);
  assert.deepEqual(applied, fs.readdirSync(real).map((f) => Number(f.slice(0, 3))));
  assert.deepEqual(migrate(db, w.migrations, w.dbPath, w.backups), []);
  assert.equal(schemaVersion(db), applied.at(-1));
  // A brand new database has nothing to back up.
  assert.equal(fs.existsSync(w.backups), false);
  db.close();
});

test('upgrading an existing database saves a copy first, with the data in it', () => {
  const w = workspace();
  fs.copyFileSync(path.join(real, '001_core.sql'), path.join(w.migrations, '001_core.sql'));
  const db = new Database(w.dbPath);
  migrate(db, w.migrations, w.dbPath, w.backups);
  db.prepare(`INSERT INTO miniatures (name, slug, created_at, updated_at) VALUES ('Kept', 'kept', 'now', 'now')`).run();

  fs.copyFileSync(path.join(real, '002_painting.sql'), path.join(w.migrations, '002_painting.sql'));
  assert.deepEqual(migrate(db, w.migrations, w.dbPath, w.backups), [2]);
  const [backup] = fs.readdirSync(w.backups);
  assert.match(backup!, /^minis_before_002_painting_.*\.db$/);
  const copy = new Database(path.join(w.backups, backup!), { readonly: true });
  assert.equal(copy.prepare('SELECT name FROM miniatures').pluck().get(), 'Kept');
  assert.equal(copy.prepare(`SELECT COUNT(*) FROM sqlite_master WHERE name = 'paints'`).pluck().get(), 0, 'the copy is from before the upgrade');
  copy.close();
  db.close();
});

test('a failing migration is rolled back and not recorded', () => {
  const w = workspace();
  fs.copyFileSync(path.join(real, '001_core.sql'), path.join(w.migrations, '001_core.sql'));
  fs.writeFileSync(path.join(w.migrations, '002_broken.sql'), 'CREATE TABLE half_done (id INTEGER);\nTHIS IS NOT SQL;');
  const db = new Database(w.dbPath);
  assert.throws(() => migrate(db, w.migrations, w.dbPath, w.backups));
  assert.equal(schemaVersion(db), 1);
  assert.equal(db.prepare(`SELECT COUNT(*) FROM sqlite_master WHERE name = 'half_done'`).pluck().get(), 0);
  db.close();
});

test('files that do not look like migrations are ignored', () => {
  const w = workspace();
  fs.copyFileSync(path.join(real, '001_core.sql'), path.join(w.migrations, '001_core.sql'));
  fs.writeFileSync(path.join(w.migrations, 'README.md'), '# notes');
  fs.writeFileSync(path.join(w.migrations, 'draft.sql'), 'NOT SQL');
  const db = new Database(w.dbPath);
  assert.deepEqual(migrate(db, w.migrations, w.dbPath, w.backups), [1]);
  db.close();
});
