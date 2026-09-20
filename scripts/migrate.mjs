import { readFile } from 'node:fs/promises';
import { Client } from 'pg';

const testMode = process.argv.includes('--test');
const connectionString = testMode ? process.env.TEST_DATABASE_URL : process.env.DATABASE_URL;

if (!connectionString) {
  console.error(testMode ? 'TEST_DATABASE_URL is required with --test.' : 'DATABASE_URL is required.');
  process.exit(1);
}

let databaseName;
try {
  databaseName = decodeURIComponent(new URL(connectionString).pathname.replace(/^\//, ''));
} catch {
  console.error('The database URL must be a valid PostgreSQL URL.');
  process.exit(1);
}

if (testMode && !databaseName.endsWith('_test')) {
  console.error(`Refusing test migration for database "${databaseName}": the database name must end with _test.`);
  process.exit(1);
}

const migration = await readFile(new URL('../db/migrations/001_initial.sql', import.meta.url), 'utf8');
const client = new Client({ connectionString });

try {
  await client.connect();
  await client.query('BEGIN');
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  const applied = await client.query('SELECT 1 FROM schema_migrations WHERE version = $1', [1]);
  if (applied.rowCount === 0) {
    await client.query(migration);
    console.log('Applied migration 001_initial.sql.');
  } else {
    console.log('Migration 001_initial.sql already applied; nothing to do.');
  }

  await client.query('COMMIT');
} catch (error) {
  await client.query('ROLLBACK').catch(() => undefined);
  console.error(error instanceof Error ? error.message : 'Migration failed.');
  process.exitCode = 1;
} finally {
  await client.end().catch(() => undefined);
}
