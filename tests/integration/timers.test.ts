import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

import * as timersRoute from '../../src/app/api/timers/route';
import { IDENTITY_COOKIE_NAME } from '../../src/lib/server/http';
import { closePool, getPool } from '../../src/lib/server/db';
import { getOrCreateIdentity } from '../../src/lib/server/identity';
import * as repository from '../../src/lib/server/repository';
import { readSnapshot } from '../../src/lib/server/repository';
import type { Command, Snapshot } from '../../src/features/timer/types';

const appOrigin = 'https://timer.example.test';
const timersUrl = `${appOrigin}/api/timers`;

type ExecuteCommand = (
  userId: string,
  expectedRevision: number,
  command: Command,
  nowMs: number,
) => Promise<Snapshot>;

type PostTimers = (request: NextRequest) => Promise<NextResponse>;

const executeCommand = (repository as typeof repository & { executeCommand: ExecuteCommand }).executeCommand;
const postTimers = (timersRoute as typeof timersRoute & { POST: PostTimers }).POST;

function requestWithCookie(
  token: string | undefined,
  body?: unknown,
  headers: Record<string, string> = {},
): NextRequest {
  const requestHeaders: Record<string, string> = {
    Origin: appOrigin,
    ...headers,
  };
  if (token) {
    requestHeaders.cookie = `${IDENTITY_COOKIE_NAME}=${token}`;
  }

  return new NextRequest(timersUrl, {
    method: 'POST',
    headers: requestHeaders,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function createIdentity(): Promise<{ userId: string; token: string }> {
  const identity = await getOrCreateIdentity();
  if (!identity.newToken) {
    throw new Error('Expected a new identity token.');
  }
  return { userId: identity.userId, token: identity.newToken };
}

async function responseBody(response: NextResponse): Promise<Record<string, unknown>> {
  return response.json() as Promise<Record<string, unknown>>;
}

beforeAll(() => {
  if (!process.env.TEST_DATABASE_URL) {
    throw new Error('TEST_DATABASE_URL is required for timer integration tests.');
  }
  process.env.APP_ORIGIN = appOrigin;
});

beforeEach(async () => {
  await getPool().query('TRUNCATE browser_tabs, timer_states, anonymous_users');
});

afterAll(async () => {
  await closePool();
});

describe('stored timer commands', () => {
  it('allows exactly one of two concurrent commands with the same revision', async () => {
    const identity = await createIdentity();

    const results = await Promise.allSettled([
      executeCommand(identity.userId, 0, { type: 'start', timer: 'up' }, 1_000),
      executeCommand(identity.userId, 0, { type: 'reset', timer: 'up' }, 1_000),
    ]);

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    const conflict = results.find((result) => result.status === 'rejected');
    expect(conflict).toMatchObject({
      status: 'rejected',
      reason: { statusCode: 409, snapshot: { revision: 1 } },
    });
  });

  it('does not reset the start timestamp when start is sent for a running timer', async () => {
    const identity = await createIdentity();

    const started = await executeCommand(identity.userId, 0, { type: 'start', timer: 'up' }, 1_000);
    const startedAgain = await executeCommand(identity.userId, started.revision, { type: 'start', timer: 'up' }, 5_000);

    expect(startedAgain.up).toEqual({ valueMs: 0, startedAtMs: 1_000 });
    expect(startedAgain.serverNowMs).toBe(5_000);
  });

  it('does not add elapsed time when pause is sent for a paused timer', async () => {
    const identity = await createIdentity();

    const paused = await executeCommand(identity.userId, 0, { type: 'pause', timer: 'up' }, 5_000);
    const pausedAgain = await executeCommand(identity.userId, paused.revision, { type: 'pause', timer: 'up' }, 9_000);

    expect(paused.up).toEqual({ valueMs: 0, startedAtMs: null });
    expect(pausedAgain.up).toEqual({ valueMs: 0, startedAtMs: null });
  });

  it('changes countdown duration without changing count-up state', async () => {
    const identity = await createIdentity();

    const started = await executeCommand(identity.userId, 0, { type: 'start', timer: 'up' }, 1_000);
    const changed = await executeCommand(
      identity.userId,
      started.revision,
      { type: 'set-duration', durationMs: 3_000 },
      2_000,
    );

    expect(changed.up).toEqual({ valueMs: 0, startedAtMs: 1_000 });
    expect(changed.down).toEqual({ valueMs: 3_000, startedAtMs: null });
    expect(changed.durationMs).toBe(3_000);
  });
});

describe('timer command HTTP boundary', () => {
  it('returns 200 with no-store for a valid cookie-derived command', async () => {
    const identity = await createIdentity();

    const response = await postTimers(requestWithCookie(identity.token, {
      expectedRevision: 0,
      command: { type: 'start', timer: 'up' },
    }));

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await responseBody(response)).toMatchObject({
      revision: 1,
      up: { valueMs: 0 },
    });
  });

  it('returns 400 for malformed commands, invalid duration, running duration changes, origin, and body size', async () => {
    const identity = await createIdentity();
    const invalidRequests = [
      requestWithCookie(identity.token, { expectedRevision: -1, command: { type: 'start', timer: 'up' } }),
      requestWithCookie(identity.token, { expectedRevision: 0.5, command: { type: 'start', timer: 'up' } }),
      requestWithCookie(identity.token, { expectedRevision: 0, command: { type: 'set-duration', durationMs: -1 } }),
      requestWithCookie(identity.token, { expectedRevision: 0, command: { type: 'set-duration', durationMs: 359_999_001 } }),
      requestWithCookie(identity.token, { expectedRevision: 0, command: { type: 'start', timer: 'sideways' } }),
      requestWithCookie(identity.token, { expectedRevision: 0, command: { type: 'start', timer: 'up' } }, { Origin: 'https://evil.example.test' }),
      requestWithCookie(identity.token, { expectedRevision: 0, command: { type: 'start', timer: 'up' } }, { Origin: '' }),
      requestWithCookie(identity.token, {
        expectedRevision: 0,
        command: { type: 'start', timer: 'up' },
        padding: 'x'.repeat(20_000),
      }),
    ];

    for (const request of invalidRequests) {
      const response = await postTimers(request);
      expect(response.status).toBe(400);
      expect(response.headers.get('cache-control')).toBe('no-store');
    }

    const started = await postTimers(requestWithCookie(identity.token, {
      expectedRevision: 0,
      command: { type: 'start', timer: 'down' },
    }));
    expect(started.status).toBe(200);
    const runningDurationChange = await postTimers(requestWithCookie(identity.token, {
      expectedRevision: 1,
      command: { type: 'set-duration', durationMs: 3_000 },
    }));
    expect(runningDurationChange.status).toBe(400);
  });

  it('returns 401 for missing and invalid cookies without creating a user', async () => {
    const missing = await postTimers(requestWithCookie(undefined, {
      expectedRevision: 0,
      command: { type: 'start', timer: 'up' },
    }));
    const invalid = await postTimers(requestWithCookie('invalid-cookie-token', {
      expectedRevision: 0,
      command: { type: 'start', timer: 'up' },
    }));

    expect(missing.status).toBe(401);
    expect(invalid.status).toBe(401);
    expect(missing.headers.get('cache-control')).toBe('no-store');
    expect(invalid.headers.get('cache-control')).toBe('no-store');
    const users = await getPool().query<{ count: string }>('SELECT count(*)::text AS count FROM anonymous_users');
    expect(users.rows[0].count).toBe('0');
  });

  it('returns the current snapshot with 409 when a stale revision is posted', async () => {
    const identity = await createIdentity();

    const first = await postTimers(requestWithCookie(identity.token, {
      expectedRevision: 0,
      command: { type: 'start', timer: 'up' },
    }));
    expect(first.status).toBe(200);

    const stale = await postTimers(requestWithCookie(identity.token, {
      expectedRevision: 0,
      command: { type: 'reset', timer: 'up' },
    }));
    expect(stale.status).toBe(409);
    expect(stale.headers.get('cache-control')).toBe('no-store');
    expect(await responseBody(stale)).toMatchObject({
      error: 'conflict',
      snapshot: { revision: 1, up: { startedAtMs: expect.any(Number) } },
    });
  });

  it('ignores a client-supplied user ID so one cookie cannot modify another user', async () => {
    const userA = await createIdentity();
    const userB = await createIdentity();

    const response = await postTimers(requestWithCookie(userA.token, {
      userId: userB.userId,
      expectedRevision: 0,
      command: { type: 'set-sound', enabled: false },
    }));

    expect(response.status).toBe(200);
    expect((await readSnapshot(userA.userId, 2_000)).soundEnabled).toBe(false);
    expect((await readSnapshot(userB.userId, 2_000)).soundEnabled).toBe(true);
  });

  it('maps database failures to 503 while preserving no-store', async () => {
    const identity = await createIdentity();
    const originalDatabaseUrl = process.env.TEST_DATABASE_URL;
    await closePool();
    process.env.TEST_DATABASE_URL = 'postgresql://count_timer_test:test_password@127.0.0.1:1/count_timer_test';

    try {
      const response = await postTimers(requestWithCookie(identity.token, {
        expectedRevision: 0,
        command: { type: 'start', timer: 'up' },
      }));

      expect(response.status).toBe(503);
      expect(response.headers.get('cache-control')).toBe('no-store');
    } finally {
      process.env.TEST_DATABASE_URL = originalDatabaseUrl;
      await closePool();
    }
  });
});
