import { spawnSync } from 'node:child_process';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
if (!testDatabaseUrl) {
  console.error('TEST_DATABASE_URL is required; production DATABASE_URL is never used for integration tests.');
  process.exit(1);
}

let databaseName;
try {
  databaseName = decodeURIComponent(new URL(testDatabaseUrl).pathname.replace(/^\//, ''));
} catch {
  console.error('TEST_DATABASE_URL must be a valid PostgreSQL URL.');
  process.exit(1);
}

if (!databaseName.endsWith('_test')) {
  console.error(`Refusing to reset or test database "${databaseName}": the database name must end with _test.`);
  process.exit(1);
}

const forwardedArgs = process.argv.slice(2);
const resetRequested = forwardedArgs.includes('--reset');
const vitestArgs = forwardedArgs.filter((argument) => argument !== '--reset');

if (resetRequested) {
  const { Client } = await import('pg');
  const client = new Client({ connectionString: testDatabaseUrl });
  try {
    await client.connect();
    await client.query('TRUNCATE browser_tabs, timer_states, anonymous_users');
  } finally {
    await client.end().catch(() => undefined);
  }
}

const testEnvironment = { ...process.env, NODE_ENV: 'test', TEST_DATABASE_URL: testDatabaseUrl };
delete testEnvironment.DATABASE_URL;

const result = spawnSync(
  'npx',
  ['--no-install', 'vitest', 'run', '--config', 'vitest.integration.config.ts', ...vitestArgs],
  { env: testEnvironment, stdio: 'inherit' },
);

process.exit(result.status ?? 1);
