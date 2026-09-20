import type { Page } from '@playwright/test';

import type { Command, Snapshot, TimerKind } from '../../../src/features/timer/types';

export const DEFAULT_DURATION_MS = 25 * 60 * 1_000;

export function makeSnapshot(overrides: Partial<Snapshot> = {}): Snapshot {
  const serverNowMs = overrides.serverNowMs ?? Date.now();
  const durationMs = overrides.durationMs ?? DEFAULT_DURATION_MS;
  return {
    revision: 0,
    serverNowMs,
    up: { valueMs: 0, startedAtMs: null },
    down: { valueMs: durationMs, startedAtMs: null },
    durationMs,
    soundEnabled: true,
    downRunId: '11111111-1111-4111-8111-111111111111',
    completedRunId: null,
    ...overrides,
  };
}

function timerValue(snapshot: Snapshot, timer: TimerKind, nowMs: number): number {
  const state = snapshot[timer];
  if (state.startedAtMs === null) return state.valueMs;
  const elapsed = Math.max(0, nowMs - state.startedAtMs);
  return timer === 'up' ? state.valueMs + elapsed : Math.max(0, state.valueMs - elapsed);
}

function applyCommand(snapshot: Snapshot, command: Command): Snapshot {
  const nowMs = Date.now();
  const next: Snapshot = {
    ...snapshot,
    revision: snapshot.revision + 1,
    serverNowMs: nowMs,
    up: { ...snapshot.up },
    down: { ...snapshot.down },
  };

  if (command.type === 'set-sound') {
    next.soundEnabled = command.enabled;
    return next;
  }
  if (command.type === 'set-duration') {
    next.durationMs = command.durationMs;
    next.down = { valueMs: command.durationMs, startedAtMs: null };
    next.completedRunId = null;
    return next;
  }

  const timer = command.timer;
  if (command.type === 'reset') {
    next[timer] = { valueMs: timer === 'up' ? 0 : next.durationMs, startedAtMs: null };
    if (timer === 'down') next.completedRunId = null;
    return next;
  }

  if (command.type === 'pause') {
    if (next[timer].startedAtMs !== null) {
      const valueMs = timerValue(next, timer, nowMs);
      next[timer] = { valueMs, startedAtMs: null };
      if (timer === 'down' && valueMs === 0) next.completedRunId = next.downRunId;
    }
    return next;
  }

  if (timer === 'down' && timerValue(next, timer, nowMs) === 0) {
    next.down = { valueMs: next.durationMs, startedAtMs: nowMs };
    next.completedRunId = null;
    return next;
  }
  if (next[timer].startedAtMs === null) next[timer].startedAtMs = nowMs;
  return next;
}

export type MockTimerStore = {
  snapshot: Snapshot;
  timerPosts: number;
  timerGets: number;
  tabActions: string[];
  alarmPosts: number;
  holdTimerPosts: boolean;
  holdTimerGets: boolean;
  failTimerPosts: boolean;
  failAlarmPosts: boolean;
  releaseTimerPosts: () => void;
  releaseTimerGets: () => void;
};

export function createMockTimerStore(snapshot = makeSnapshot()): MockTimerStore {
  let releasePost: (() => void) | null = null;
  let releaseGet: (() => void) | null = null;
  return {
    snapshot,
    timerPosts: 0,
    timerGets: 0,
    tabActions: [],
    alarmPosts: 0,
    holdTimerPosts: false,
    holdTimerGets: false,
    failTimerPosts: false,
    failAlarmPosts: false,
    releaseTimerPosts: () => {
      releasePost?.();
      releasePost = null;
    },
    releaseTimerGets: () => {
      releaseGet?.();
      releaseGet = null;
    },
  };
}

async function fulfillJson(route: Parameters<Parameters<Page['route']>[1]>[0], body: unknown, status = 200) {
  await route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify(body),
  });
}

export async function installTimerApi(page: Page, store = createMockTimerStore()): Promise<MockTimerStore> {
  await page.route('**/api/bootstrap', (route) => fulfillJson(route, store.snapshot));
  await page.route('**/api/tabs', async (route) => {
    const request = route.request();
    const body = request.postDataJSON() as { action?: string } | null;
    if (body?.action) store.tabActions.push(body.action);
    await fulfillJson(route, store.snapshot);
  });
  await page.route('**/api/timers', async (route) => {
    if (route.request().method() === 'GET') {
      store.timerGets += 1;
      const responseSnapshot = store.snapshot;
      if (store.holdTimerGets) {
        await new Promise<void>((resolve) => {
          store.releaseTimerGets = resolve;
        });
      }
      await fulfillJson(route, responseSnapshot);
      return;
    }
    store.timerPosts += 1;
    if (store.holdTimerPosts) {
      await new Promise<void>((resolve) => {
        store.releaseTimerPosts = resolve;
      });
    }
    if (store.failTimerPosts) {
      await fulfillJson(route, { error: 'service_unavailable' }, 503);
      return;
    }
    const body = route.request().postDataJSON() as { command: Command };
    store.snapshot = applyCommand(store.snapshot, body.command);
    await fulfillJson(route, store.snapshot);
  });
  await page.route('**/api/alarms', (route) => {
    store.alarmPosts += 1;
    return store.failAlarmPosts
      ? fulfillJson(route, { error: 'service_unavailable' }, 503)
      : fulfillJson(route, { granted: true });
  });
  return store;
}

export const visualSnapshots = {
  upZero: makeSnapshot(),
  upLong: makeSnapshot({ up: { valueMs: 125 * 3_600_000 + 3 * 60_000 + 9_000, startedAtMs: null } }),
  upRunning: makeSnapshot({ up: { valueMs: 10_000, startedAtMs: Date.now() - 2_000 } }),
  downTwentyFive: makeSnapshot(),
  downPaused: makeSnapshot({ down: { valueMs: 12 * 60_000 + 3_000, startedAtMs: null } }),
  downEnded: makeSnapshot({ down: { valueMs: 0, startedAtMs: null }, completedRunId: '22222222-2222-4222-8222-222222222222' }),
};
