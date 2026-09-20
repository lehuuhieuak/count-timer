import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { NextRequest, type NextResponse } from 'next/server';

import * as alarmsRoute from '../../src/app/api/alarms/route';
import { IDENTITY_COOKIE_NAME } from '../../src/lib/server/http';
import { closePool, getPool } from '../../src/lib/server/db';
import { getOrCreateIdentity } from '../../src/lib/server/identity';
import { executeCommand, readSnapshot } from '../../src/lib/server/repository';
import { touchTab } from '../../src/lib/server/leases';

const appOrigin = 'https://timer.example.test';
const alarmsUrl = `${appOrigin}/api/alarms`;

type PostAlarms = (request: NextRequest) => Promise<NextResponse>;
const postAlarms = (alarmsRoute as typeof alarmsRoute & { POST: PostAlarms }).POST;

function requestWithCookie(token: string | undefined, body?: unknown, origin = appOrigin): NextRequest {
  const headers: Record<string, string> = { Origin: origin };
  if (token) {
    headers.cookie = `${IDENTITY_COOKIE_NAME}=${token}`;
  }

  return new NextRequest(alarmsUrl, {
    method: 'POST',
    headers,
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

beforeAll(() => {
  if (!process.env.TEST_DATABASE_URL) {
    throw new Error('TEST_DATABASE_URL is required for alarm integration tests.');
  }
  process.env.APP_ORIGIN = appOrigin;
});

beforeEach(async () => {
  await getPool().query('TRUNCATE browser_tabs, timer_states, anonymous_users');
});

afterAll(async () => {
  await closePool();
});

describe('countdown alarm claims', () => {
  it('grants exactly one concurrent claim for a completed run', async () => {
    const identity = await createIdentity();
    await touchTab(identity.userId, 'tab-a', 'open', 1_000);
    let snapshot = await readSnapshot(identity.userId, 1_000);
    snapshot = await executeCommand(identity.userId, snapshot.revision, { type: 'set-duration', durationMs: 2_000 }, 1_000);
    snapshot = await executeCommand(identity.userId, snapshot.revision, { type: 'start', timer: 'down' }, 1_000);
    const runId = snapshot.downRunId;
    await touchTab(identity.userId, 'tab-a', 'close', 4_000);

    const results = await Promise.all([
      postAlarms(requestWithCookie(identity.token, { runId })),
      postAlarms(requestWithCookie(identity.token, { runId })),
    ]);

    expect(results.map((response) => response.status)).toEqual([200, 200]);
    expect((await Promise.all(results.map((response) => response.json()))).map((body) => body.granted).sort()).toEqual([
      false,
      true,
    ]);
    expect(await readSnapshot(identity.userId, 4_000)).toMatchObject({ completedRunId: runId });
    const claimState = await getPool().query<{ alarm_claimed: boolean }>(
      'SELECT alarm_claimed FROM timer_states WHERE user_id = $1',
      [identity.userId],
    );
    expect(claimState.rows[0].alarm_claimed).toBe(true);
  });

  it('rejects claims for a running, unknown, or already claimed run', async () => {
    const identity = await createIdentity();
    await touchTab(identity.userId, 'tab-a', 'open', 1_000);
    let snapshot = await readSnapshot(identity.userId, 1_000);
    snapshot = await executeCommand(identity.userId, snapshot.revision, { type: 'set-duration', durationMs: 5_000 }, 1_000);
    snapshot = await executeCommand(identity.userId, snapshot.revision, { type: 'start', timer: 'down' }, 1_000);

    const running = await postAlarms(requestWithCookie(identity.token, { runId: snapshot.downRunId }));
    const unknown = await postAlarms(requestWithCookie(identity.token, { runId: '00000000-0000-0000-0000-000000000000' }));
    expect(await running.json()).toEqual({ granted: false });
    expect(await unknown.json()).toEqual({ granted: false });

    await touchTab(identity.userId, 'tab-a', 'close', 7_000);
    const completed = await readSnapshot(identity.userId, 7_000);
    const firstClaim = await postAlarms(requestWithCookie(identity.token, { runId: completed.downRunId }));
    const secondClaim = await postAlarms(requestWithCookie(identity.token, { runId: completed.downRunId }));
    expect(await firstClaim.json()).toEqual({ granted: true });
    expect(await secondClaim.json()).toEqual({ granted: false });
  });
});

describe('alarms HTTP boundary', () => {
  it('validates same-origin requests and uses no-store responses', async () => {
    const identity = await createIdentity();
    const valid = await postAlarms(requestWithCookie(identity.token, { runId: '00000000-0000-0000-0000-000000000000' }));
    expect(valid.status).toBe(200);
    expect(valid.headers.get('cache-control')).toBe('no-store');

    const invalid = await postAlarms(requestWithCookie(identity.token, { runId: 'not-a-run-id' }));
    const wrongOrigin = await postAlarms(
      requestWithCookie(identity.token, { runId: '00000000-0000-0000-0000-000000000000' }, 'https://evil.example.test'),
    );
    const missingCookie = await postAlarms(
      requestWithCookie(undefined, { runId: '00000000-0000-0000-0000-000000000000' }),
    );

    expect(invalid.status).toBe(400);
    expect(wrongOrigin.status).toBe(400);
    expect(missingCookie.status).toBe(401);
    for (const response of [invalid, wrongOrigin, missingCookie]) {
      expect(response.headers.get('cache-control')).toBe('no-store');
    }
  });
});
