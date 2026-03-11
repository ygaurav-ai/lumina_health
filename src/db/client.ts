/**
 * PostgreSQL client — uses DATABASE_URL env var so it works on both
 * local Postgres and Replit (add DATABASE_URL to Replit Secrets panel).
 */
import { Pool, PoolClient, QueryResult, QueryResultRow } from 'pg';

const connectionString =
  process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/lumina_health';

export const pool = new Pool({ connectionString });

/** Thin wrapper: run a parameterised query and return all rows. */
export async function query<T extends QueryResultRow = Record<string, unknown>>(
  sql: string,
  params?: unknown[]
): Promise<QueryResult<T>> {
  const client: PoolClient = await pool.connect();
  try {
    return await client.query<T>(sql, params);
  } finally {
    client.release();
  }
}

/** Gracefully close the pool (used in tests / shutdown hooks). */
export async function closePool(): Promise<void> {
  await pool.end();
}
