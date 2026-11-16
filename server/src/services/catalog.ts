import fs from 'node:fs';
import path from 'node:path';
import type { FastifyBaseLogger } from 'fastify';
import { z } from 'zod';
import { catalogEntrySchema, type CatalogEntry } from '@minibald/shared';
import type { Config } from '../config.ts';

type Entry = Omit<CatalogEntry, 'paintId'>;

let cache: { key: string; entries: Entry[] } | null = null;

/**
 * The catalogue is plain JSON, not database rows: files shipped with the app plus any
 * *.json dropped into data/catalogs (same shape). It is re-read when a file changes,
 * so adding a brand needs no restart and no migration.
 */
export function loadCatalog(config: Config, log: FastifyBaseLogger): Entry[] {
  const files = [config.catalogDir, path.join(config.dataDir, 'catalogs')]
    .filter((dir) => fs.existsSync(dir))
    .flatMap((dir) =>
      fs
        .readdirSync(dir)
        .filter((f) => f.endsWith('.json'))
        .sort()
        .map((f) => path.join(dir, f)),
    );
  const key = files.map((f) => `${f}:${fs.statSync(f).mtimeMs}`).join('|');
  if (cache?.key === key) return cache.entries;

  const seen = new Set<string>();
  const entries: Entry[] = [];
  for (const file of files) {
    try {
      const parsed = z.array(catalogEntrySchema).parse(JSON.parse(fs.readFileSync(file, 'utf8')));
      for (const e of parsed) {
        const id = `${e.brand}|${e.range}|${e.name}`.toLowerCase();
        if (seen.has(id)) continue;
        seen.add(id);
        entries.push({ brand: e.brand, range: e.range, name: e.name, type: e.type ?? null, hex: e.hex ?? null });
      }
    } catch (err) {
      log.warn(`Skipping paint catalogue ${file}: ${(err as Error).message.slice(0, 300)}`);
    }
  }
  cache = { key, entries };
  return entries;
}
