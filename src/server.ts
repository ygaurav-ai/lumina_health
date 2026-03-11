/**
 * Server entrypoint.
 * Reads PORT and HOST from environment variables so it works on both
 * local development and Replit (which sets PORT automatically).
 */
import { buildApp } from './app';

const PORT = parseInt(process.env.PORT ?? '3000', 10);
const HOST = process.env.HOST ?? '0.0.0.0';

async function start(): Promise<void> {
  const app = await buildApp();

  try {
    await app.listen({ port: PORT, host: HOST });
    app.log.info(`Lumina Health Phase 0 listening on ${HOST}:${PORT}`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

start();
