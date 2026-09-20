import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';

import { GET as getTimers } from '../../src/app/api/timers/route';
import { POST as bootstrap } from '../../src/app/api/bootstrap/route';
import { IDENTITY_COOKIE_NAME } from '../../src/lib/server/http';
import { closePool, getPool } from '../../src/lib/server/db';
import { getOrCreateIdentity } from '../../src/lib/server/identity';
import { readSnapshot } from '../../src/lib/server/repository';

const bootstrapUrl = 'https://timer.example.test/api/bootstrap';
const timersUrl = 'https://timer.example.test/api/timers';

function requestWithCookie(url: string, token: string): NextRequest {
  return new NextRequest(url, {
    headers: { cookie: `${IDENTITY_COOKIE_NAME}=${token}` },
  });
}

beforeAll(() => {
  if (!process.env.TEST_DATABASE_URL) {
    throw new Error('TEST_DATABASE_URL is required for identity integration tests.');
  }
  process.env.APP_ORIGIN = 'https://timer.example.test';
});

beforeEach(async () => {
  await getPool().query('TRUNCATE browser_tabs, timer_states, anonymous_users');
});

afterAll(async () => {
  await closePool();
});

describe('anonymous identity persistence', () => {
  it('creates separate users, reuses a valid token, and rejects an invalid token', async () => {
    const a = await getOrCreateIdentity();
    const b = await getOrCreateIdentity();

    expect(a.userId).not.toBe(b.userId);
    expect(a.newToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(b.newToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    await expect(getOrCreateIdentity(a.newToken)).resolves.toEqual({ userId: a.userId });
    await expect(getOrCreateIdentity('invalid-cookie-token')).rejects.toMatchObject({ statusCode: 401 });
  });

  it('bootstraps default timer state atomically', async () => {
    const identity = await getOrCreateIdentity();
    const snapshot = await readSnapshot(identity.userId, 1_700_000_000_000);

    expect(snapshot).toMatchObject({
      revision: 0,
      serverNowMs: 1_700_000_000_000,
      up: { valueMs: 0, startedAtMs: null },
      down: { valueMs: 1_500_000, startedAtMs: null },
      durationMs: 1_500_000,
      soundEnabled: true,
      completedRunId: null,
    });
    expect(snapshot.downRunId).toEqual(expect.any(String));

    const counts = await getPool().query<{ users: string; timers: string }>(
      `SELECT
         (SELECT count(*) FROM anonymous_users)::text AS users,
         (SELECT count(*) FROM timer_states)::text AS timers`,
    );
    expect(counts.rows[0]).toEqual({ users: '1', timers: '1' });
  });

  it('stores a fixed-size token hash and no plaintext token', async () => {
    const identity = await getOrCreateIdentity();
    const token = identity.newToken;
    expect(token).toBeDefined();

    const columns = await getPool().query<{ column_name: string }>(
      `SELECT column_name
       FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'anonymous_users'`,
    );
    expect(columns.rows.map((row) => row.column_name)).not.toContain('token');

    const rows = await getPool().query<{ token_type: string; token_length: number; token_hash: Buffer }>(
      `SELECT pg_typeof(token_hash)::text AS token_type,
              octet_length(token_hash) AS token_length,
              token_hash
       FROM anonymous_users`,
    );
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0].token_type).toBe('bytea');
    expect(Number(rows.rows[0].token_length)).toBe(32);
    expect(rows.rows[0].token_hash.equals(Buffer.from(token!, 'utf8'))).toBe(false);
  });
});

describe('bootstrap HTTP identity boundary', () => {
  it('assigns two cookie jars, reuses one jar, and sets secure one-year cookie flags', async () => {
    const firstResponse = await bootstrap(new NextRequest(bootstrapUrl, { method: 'POST' }));
    const secondResponse = await bootstrap(new NextRequest(bootstrapUrl, { method: 'POST' }));
    const firstCookie = firstResponse.cookies.get(IDENTITY_COOKIE_NAME);
    const secondCookie = secondResponse.cookies.get(IDENTITY_COOKIE_NAME);

    expect(firstResponse.status).toBe(200);
    expect(secondResponse.status).toBe(200);
    expect(firstCookie?.value).toBeDefined();
    expect(secondCookie?.value).toBeDefined();
    expect(firstCookie?.value).not.toBe(secondCookie?.value);
    expect(firstCookie).toMatchObject({
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      path: '/',
      maxAge: 31_536_000,
    });
    expect(firstResponse.headers.get('cache-control')).toBe('no-store');

    const reusedResponse = await bootstrap(requestWithCookie(bootstrapUrl, firstCookie!.value));
    expect(reusedResponse.status).toBe(200);
    expect(reusedResponse.cookies.get(IDENTITY_COOKIE_NAME)).toMatchObject({
      value: firstCookie!.value,
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      path: '/',
      maxAge: 31_536_000,
    });

    const identities = await Promise.all([
      getOrCreateIdentity(firstCookie!.value),
      getOrCreateIdentity(secondCookie!.value),
    ]);
    expect(identities[0].userId).not.toBe(identities[1].userId);
  });

  it('does not create identity for a missing or invalid non-bootstrap cookie', async () => {
    const missingResponse = await getTimers(new NextRequest(timersUrl));
    const invalidResponse = await getTimers(requestWithCookie(timersUrl, 'invalid-cookie-token'));

    expect(missingResponse.status).toBe(401);
    expect(invalidResponse.status).toBe(401);
    const counts = await getPool().query<{ users: string }>('SELECT count(*)::text AS users FROM anonymous_users');
    expect(counts.rows[0].users).toBe('0');
  });
});
