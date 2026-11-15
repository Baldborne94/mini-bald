import fs from 'node:fs';
import Fastify, { type FastifyInstance } from 'fastify';
import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import { ZodError } from 'zod';
import type { Config } from './config.ts';
import { openDatabase, type Db } from './db/connection.ts';
import { HttpError } from './lib/http.ts';
import { groupRoutes } from './routes/groups.ts';
import { miniatureRoutes } from './routes/miniatures.ts';
import { miscRoutes } from './routes/misc.ts';
import { paintRoutes } from './routes/paints.ts';
import { photoRoutes } from './routes/photos.ts';
import { recipeRoutes } from './routes/recipes.ts';
import { sessionRoutes } from './routes/sessions.ts';

export interface Ctx {
  db: Db;
  config: Config;
}

export async function buildApp(config: Config): Promise<FastifyInstance> {
  const db = openDatabase(config);
  const app = Fastify({ logger: config.logger ? { level: 'info' } : false, bodyLimit: 2 * 1024 * 1024 });
  app.addHook('onClose', () => {
    db.close();
  });

  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof ZodError) {
      const first = err.issues[0];
      return reply.code(400).send({ error: first ? `${first.path.join('.') || 'body'}: ${first.message}` : 'Invalid input', issues: err.issues });
    }
    if (err instanceof HttpError) return reply.code(err.status).send({ error: err.message });
    const status = (err as { statusCode?: number }).statusCode;
    if (status && status < 500) return reply.code(status).send({ error: (err as Error).message });
    app.log.error(err);
    return reply.code(500).send({ error: 'Internal server error' });
  });

  await app.register(multipart, { limits: { fileSize: 25 * 1024 * 1024, files: 20 } });

  await app.register(
    async (api) => {
      const ctx: Ctx = { db, config };
      miscRoutes(api, ctx);
      groupRoutes(api, ctx);
      miniatureRoutes(api, ctx);
      photoRoutes(api, ctx);
      paintRoutes(api, ctx);
      recipeRoutes(api, ctx);
      sessionRoutes(api, ctx);
    },
    { prefix: '/api' },
  );

  // In production the same process serves the built client; in dev Vite does.
  const hasClient = fs.existsSync(config.clientDist);
  if (hasClient) await app.register(fastifyStatic, { root: config.clientDist, wildcard: false });
  app.setNotFoundHandler((req, reply) => {
    if (hasClient && req.method === 'GET' && !req.url.startsWith('/api/')) {
      return reply.header('Cache-Control', 'no-cache').sendFile('index.html');
    }
    return reply.code(404).send({ error: 'Not found' });
  });

  return app;
}
