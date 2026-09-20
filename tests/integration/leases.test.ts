import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { NextRequest, type NextResponse } from 'next/server';

import * as tabsRoute from '../../src/app/api/tabs/route';
import { IDENTITY_COOKIE_NAME } from '../../src/lib/server/http';
import { closePool, getPool } from '../../src/lib/server/db';
import { getOrCreateIdentity } from '../../src/lib/server/identity';
import { readSnapshot, executeCommand } from '../../src/lib/server/repository';
import { touchTab } from '../../src/lib/server/leases';
import type { Command, Snapshot } from '../../src/features/timer/types';

const appOrigin = 'https://timer.example.test';
const tabsUrl = `${appOrigin}/api/tabs`;

type PostTabs = (request: NextRequest) => Promise<NextResponse>;
const postTabs = (tabsRoute as typeof tabsRoute & { POST: PostTabs }).POST;

function requestWithCookie(token: string | undefined, body?: unknown, origin = appOrigin): NextRequest {
  const headers: Record<string, string> = { Origin: origin };
  if (token) {
    headers.cookie = `${IDENTITY_COOKIE_NAME}=${token}`;
  }

  return new NextRequest(tabsUrl, {
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

async function startTimer(
  userId: string,
  expectedRevision: number,
  command: Command,
  nowMs: number,
): Promise<Snapshot> {
  return executeCommand(userId, expectedRevision, command, nowMs);
}

beforeAll(() => {
  if (!process.env.TEST_DATABASE_URL) {
    throw new Error('TEST_DATABASE_URL is required for lease integration tests.');
  }
  process.env.APP_ORIGIN = appOrigin;
});

beforeEach(async () => {
  await getPool().query('TRUNCATE browser_tabs, timer_states, anonymous_users');
});

afterAll(async () => {
  await closePool();
});

describe('browser tab leases', () => {
  it('keeps both timers running while another tab still holds a lease', async () => {
    const identity = await createIdentity();

    await touchTab(identity.userId, 'tab-a', 'open', 1_000);
    await touchTab(identity.userId, 'tab-b', 'open', 1_000);
    let snapshot = await readSnapshot(identity.userId, 1_000);
    snapshot = await startTimer(identity.userId, snapshot.revision, { type: 'start', timer: 'up' }, 1_000);
    await startTimer(identity.userId, snapshot.revision, { type: 'start', timer: 'down' }, 1_000);

    await touchTab(identity.userId, 'tab-a', 'close', 2_000);
    const oneTabLeft = await readSnapshot(identity.userId, 2_000);
    expect(oneTabLeft.up.startedAtMs).toBe(1_000);
    expect(oneTabLeft.down.startedAtMs).toBe(1_000);

    await touchTab(identity.userId, 'tab-b', 'close', 3_000);
    const lastTabClosed = await readSnapshot(identity.userId, 3_000);
    expect(lastTabClosed.up).toEqual({ valueMs: 2_000, startedAtMs: null });
    expect(lastTabClosed.down).toEqual({ valueMs: 1_498_000, startedAtMs: null });
  });

  it('uses the last heartbeat when a tab disappears without a close beacon', async () => {
    const identity = await createIdentity();

    await touchTab(identity.userId, 'tab-a', 'open', 1_000);
    const started = await startTimer(identity.userId, 0, { type: 'start', timer: 'up' }, 1_000);

    const reconciled = await readSnapshot(identity.userId, 91_000);
    expect(reconciled.revision).toBe(started.revision + 1);
    expect(reconciled.up).toEqual({ valueMs: 0, startedAtMs: null });

    await touchTab(identity.userId, 'tab-new', 'open', 100_000);
    const reopened = await readSnapshot(identity.userId, 101_000);
    expect(reopened.up).toEqual({ valueMs: 0, startedAtMs: null });
  });

  it('reconciles an expired lease before accepting a late heartbeat', async () => {
    const identity = await createIdentity();

    await touchTab(identity.userId, 'tab-a', 'open', 1_000);
    await startTimer(identity.userId, 0, { type: 'start', timer: 'up' }, 1_000);

    const afterLateHeartbeat = await touchTab(identity.userId, 'tab-a', 'heartbeat', 91_000);
    expect(afterLateHeartbeat.up).toEqual({ valueMs: 0, startedAtMs: null });
    const activeTabs = await getPool().query<{ tab_id: string; closed_at_ms: string | null }>(
      'SELECT tab_id, closed_at_ms FROM browser_tabs WHERE user_id = $1',
      [identity.userId],
    );
    expect(activeTabs.rows).toEqual([{ tab_id: 'tab-a', closed_at_ms: null }]);
  });

  it('pauses at the maximum stored close signal when close requests arrive out of order', async () => {
    const identity = await createIdentity();

    await touchTab(identity.userId, 'tab-a', 'open', 1_000);
    await touchTab(identity.userId, 'tab-b', 'open', 1_000);
    await startTimer(identity.userId, 0, { type: 'start', timer: 'up' }, 1_000);

    await touchTab(identity.userId, 'tab-a', 'close', 4_000);
    await touchTab(identity.userId, 'tab-b', 'close', 3_000);

    expect((await readSnapshot(identity.userId, 3_000)).up).toEqual({
      valueMs: 3_000,
      startedAtMs: null,
    });
  });

  it('preserves the newest heartbeat when an older heartbeat arrives late and reopens a closed tab', async () => {
    const identity = await createIdentity();

    await touchTab(identity.userId, 'tab-a', 'open', 1_000);
    await startTimer(identity.userId, 0, { type: 'start', timer: 'up' }, 1_000);
    await touchTab(identity.userId, 'tab-a', 'heartbeat', 5_000);
    await touchTab(identity.userId, 'tab-a', 'heartbeat', 3_000);

    expect((await readSnapshot(identity.userId, 94_000)).up.startedAtMs).toBe(1_000);

    await touchTab(identity.userId, 'tab-a', 'close', 6_000);
    await touchTab(identity.userId, 'tab-a', 'heartbeat', 4_000);
    const tab = await getPool().query<{ last_seen_at_ms: string; closed_at_ms: string | null }>(
      'SELECT last_seen_at_ms, closed_at_ms FROM browser_tabs WHERE user_id = $1 AND tab_id = $2',
      [identity.userId, 'tab-a'],
    );
    expect(tab.rows).toEqual([{ last_seen_at_ms: '5000', closed_at_ms: null }]);
  });

  it('does not let a stale tab close a newer tab lease', async () => {
    const identity = await createIdentity();

    await touchTab(identity.userId, 'tab-old', 'open', 1_000);
    await startTimer(identity.userId, 0, { type: 'start', timer: 'up' }, 1_000);
    await touchTab(identity.userId, 'tab-new', 'open', 2_000);
    await touchTab(identity.userId, 'tab-old', 'close', 3_000);

    const snapshot = await readSnapshot(identity.userId, 3_000);
    expect(snapshot.up.startedAtMs).toBe(1_000);

    await touchTab(identity.userId, 'tab-new', 'close', 4_000);
    await touchTab(identity.userId, 'tab-new', 'close', 5_000);
    expect((await readSnapshot(identity.userId, 5_000)).up).toEqual({
      valueMs: 3_000,
      startedAtMs: null,
    });
  });

  it('preserves a countdown completion when the last lease closes after zero', async () => {
    const identity = await createIdentity();

    await touchTab(identity.userId, 'tab-a', 'open', 1_000);
    let snapshot = await readSnapshot(identity.userId, 1_000);
    snapshot = await startTimer(identity.userId, snapshot.revision, { type: 'set-duration', durationMs: 2_000 }, 1_000);
    await startTimer(identity.userId, snapshot.revision, { type: 'start', timer: 'down' }, 1_000);
    const runId = snapshot.downRunId;

    await touchTab(identity.userId, 'tab-a', 'close', 4_000);
    const completed = await readSnapshot(identity.userId, 4_000);
    expect(completed.down).toEqual({ valueMs: 0, startedAtMs: null });
    expect(completed.completedRunId).toBe(runId);
  });

  it('keeps the remaining countdown when the last lease closes before zero', async () => {
    const identity = await createIdentity();

    await touchTab(identity.userId, 'tab-a', 'open', 1_000);
    let snapshot = await readSnapshot(identity.userId, 1_000);
    snapshot = await startTimer(identity.userId, snapshot.revision, { type: 'set-duration', durationMs: 5_000 }, 1_000);
    await startTimer(identity.userId, snapshot.revision, { type: 'start', timer: 'down' }, 1_000);

    await touchTab(identity.userId, 'tab-a', 'close', 3_000);
    const paused = await readSnapshot(identity.userId, 3_000);
    expect(paused.down).toEqual({ valueMs: 3_000, startedAtMs: null });
    expect(paused.completedRunId).toBeNull();
  });

  it('pauses both running timers when reconciliation finds no active leases and keeps them paused after reopen', async () => {
    const identity = await createIdentity();

    await touchTab(identity.userId, 'tab-a', 'open', 1_000);
    let snapshot = await readSnapshot(identity.userId, 1_000);
    snapshot = await executeCommand(
      identity.userId,
      snapshot.revision,
      { type: 'set-duration', durationMs: 5_000 },
      1_000,
    );
    snapshot = await executeCommand(
      identity.userId,
      snapshot.revision,
      { type: 'start', timer: 'up' },
      1_000,
    );
    await executeCommand(identity.userId, snapshot.revision, { type: 'start', timer: 'down' }, 1_000);

    await getPool().query(
      `UPDATE browser_tabs SET closed_at_ms = $3 WHERE user_id = $1 AND tab_id = $2`,
      [identity.userId, 'tab-a', 2_000],
    );

    const paused = await readSnapshot(identity.userId, 5_000);
    expect(paused.up).toEqual({ valueMs: 1_000, startedAtMs: null });
    expect(paused.down).toEqual({ valueMs: 4_000, startedAtMs: null });

    await touchTab(identity.userId, 'tab-new', 'open', 6_000);
    const reopened = await readSnapshot(identity.userId, 6_000);
    expect(reopened.up).toEqual({ valueMs: 1_000, startedAtMs: null });
    expect(reopened.down).toEqual({ valueMs: 4_000, startedAtMs: null });
  });
});

describe('tabs HTTP boundary', () => {
  it('returns a no-store snapshot for valid same-origin lease requests', async () => {
    const identity = await createIdentity();
    const response = await postTabs(requestWithCookie(identity.token, { tabId: 'tab-a', action: 'open' }));

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toMatchObject({ revision: 0 });
  });

  it('rejects invalid lease bodies, origins, and cookies', async () => {
    const identity = await createIdentity();
    const requests = [
      requestWithCookie(identity.token, { tabId: '', action: 'open' }),
      requestWithCookie(identity.token, { tabId: 'tab-a', action: 'toggle' }),
      requestWithCookie(identity.token, { tabId: 'tab-a', action: 'open' }, 'https://evil.example.test'),
      requestWithCookie(undefined, { tabId: 'tab-a', action: 'open' }),
    ];

    const responses = await Promise.all(requests.map((request) => postTabs(request)));
    expect(responses.map((response) => response.status)).toEqual([400, 400, 400, 401]);
    for (const response of responses) {
      expect(response.headers.get('cache-control')).toBe('no-store');
    }
  });
});
