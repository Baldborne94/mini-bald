import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Works both from src/ (tsx) and dist/ (bundle): each sits two levels below the repo root.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

export interface Config {
  port: number;
  host: string;
  dataDir: string;
  migrationsDir: string;
  clientDist: string;
  ai: { apiKey: string | null; model: string | null };
  logger: boolean;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return {
    port: Number(env.PORT ?? 8080),
    host: env.HOST ?? '0.0.0.0',
    dataDir: path.resolve(env.DATA_DIR ?? path.join(root, 'data')),
    migrationsDir: path.resolve(env.MIGRATIONS_DIR ?? path.join(root, 'server/migrations')),
    clientDist: path.resolve(env.CLIENT_DIST ?? path.join(root, 'client/dist')),
    ai: { apiKey: env.ANTHROPIC_API_KEY || null, model: env.AI_MODEL || null },
    logger: env.LOG !== 'off',
  };
}
