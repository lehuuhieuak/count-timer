import { Pool, type PoolClient } from 'pg';

const MAX_POOL_SIZE = 10;
let pool: Pool | null = null;

function isTestProcess(): boolean {
  return process.env.NODE_ENV === 'test' || process.env.VITEST === 'true';
}

function databaseUrl(): string {
  if (isTestProcess()) {
    const testUrl = process.env.TEST_DATABASE_URL;
    if (!testUrl) {
      throw new Error('TEST_DATABASE_URL is required for test database access.');
    }
    return testUrl;
  }

  const productionUrl = process.env.DATABASE_URL;
  if (!productionUrl) {
    throw new Error('DATABASE_URL is required for database access.');
  }
  return productionUrl;
}

export function getPool(): Pool {
  if (!pool) {
    pool = new Pool({
      connectionString: databaseUrl(),
      max: MAX_POOL_SIZE,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
    });
  }
  return pool;
}

export async function withTransaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function closePool(): Promise<void> {
  if (pool) {
    const currentPool = pool;
    pool = null;
    await currentPool.end();
  }
}
