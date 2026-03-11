/**
 * Fastify application factory.
 * Export `buildApp` so tests can instantiate the app without binding to a port.
 */
import Fastify, { FastifyInstance } from 'fastify';
import multipart from '@fastify/multipart';
import { ingestRoutes } from './routes/ingest';
import { profileRoutes } from './routes/profile';
import { dashboardRoutes } from './routes/dashboard';

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: process.env.LOG_LEVEL ?? 'info',
    },
  });

  // ── Plugins ────────────────────────────────────────────────────────────────
  await app.register(multipart, {
    limits: {
      fileSize: 10 * 1024 * 1024, // 10 MB max CSV upload
      files: 1,
    },
  });

  // ── Routes ─────────────────────────────────────────────────────────────────
  await app.register(ingestRoutes);
  await app.register(profileRoutes);
  await app.register(dashboardRoutes);

  // ── Health check ──────────────────────────────────────────────────────────
  app.get('/health', async (_req, _reply) => ({ status: 'ok', phase: 1 }));

  return app;
}
