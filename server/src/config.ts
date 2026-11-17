import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Works both from src/ (tsx) and dist/ (bundle): each sits two levels below the repo root.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

export interface Config {
  port: number;
  host: string;
  dataDir: string;
  migrationsDir: string;
  /** Bundled paint catalogue files. */
  catalogDir: string;
  clientDist: string;
  ai: {
    /** 'anthropic' (default) or 'mock' (canned answers, for development and tests). */
    provider: string;
    apiKey: string | null;
    /** Override of the API endpoint (a gateway or proxy); normally unset. */
    baseUrl: string | null;
    model: string;
    /** Optional effort level; left unset the model's own default applies. */
    effort: string | null;
    /** Language the assistant answers in. */
    language: string;
    webSearchTool: string;
    /** Long edge, in pixels, of photos sent to the model. */
    imageMaxEdge: number;
  };
  logger: boolean;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return {
    port: Number(env.PORT ?? 8080),
    host: env.HOST ?? '0.0.0.0',
    dataDir: path.resolve(env.DATA_DIR ?? path.join(root, 'data')),
    migrationsDir: path.resolve(env.MIGRATIONS_DIR ?? path.join(root, 'server/migrations')),
    catalogDir: path.resolve(env.CATALOG_DIR ?? path.join(root, 'server/catalog')),
    clientDist: path.resolve(env.CLIENT_DIST ?? path.join(root, 'client/dist')),
    ai: {
      provider: env.AI_PROVIDER || 'anthropic',
      apiKey: env.ANTHROPIC_API_KEY || null,
      baseUrl: env.ANTHROPIC_BASE_URL || null,
      model: env.AI_MODEL || 'claude-opus-5-5',
      effort: env.AI_EFFORT || null,
      language: env.AI_LANGUAGE || 'English',
      webSearchTool: env.AI_WEB_SEARCH_TOOL || 'web_search_20260209',
      imageMaxEdge: Number(env.AI_IMAGE_MAX_EDGE) || 2000,
    },
    logger: env.LOG !== 'off',
  };
}
