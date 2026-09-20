import type { PoolClient } from 'pg';

import type { Snapshot } from '../../features/timer/types';
import { withTransaction } from './db';
import {
  materializeCountdownCompletion,
  pauseTimersAt,
  persistTimerState,
  safeTimestampToNumber,
  selectTimerState,
  stateFromRow,
  type TimerState,
} from './timer-state';

export const LEASE_DURATION_MS = 90_000;

type TabRow = {
  tab_id: string;
  last_seen_at_ms: string;
};

type StoredTabSignalRow = {
  last_seen_at_ms: string;
  closed_at_ms: string | null;
};

export type TabAction = 'open' | 'heartbeat' | 'close';

function requireSafeTimestamp(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${field} must be a non-negative safe integer.`);
  }
}

function requireTabId(tabId: string): void {
  if (typeof tabId !== 'string' || tabId.length === 0 || tabId.length > 256) {
    throw new RangeError('tabId must be a non-empty string of at most 256 characters.');
  }
}

async function activeTabs(client: PoolClient, userId: string): Promise<TabRow[]> {
  const result = await client.query<TabRow>(
    `SELECT tab_id, last_seen_at_ms
     FROM browser_tabs
     WHERE user_id = $1 AND closed_at_ms IS NULL
     FOR UPDATE`,
    [userId],
  );
  return result.rows;
}

async function deleteExpiredTabs(client: PoolClient, userId: string, thresholdMs: number): Promise<void> {
  await client.query(
    `DELETE FROM browser_tabs
     WHERE user_id = $1
       AND closed_at_ms IS NULL
       AND last_seen_at_ms <= $2`,
    [userId, thresholdMs],
  );
}

async function latestStoredTabSignal(client: PoolClient, userId: string): Promise<number | null> {
  const result = await client.query<StoredTabSignalRow>(
    `SELECT last_seen_at_ms, closed_at_ms
     FROM browser_tabs
     WHERE user_id = $1
     FOR UPDATE`,
    [userId],
  );
  if (result.rows.length === 0) return null;

  return Math.max(
    ...result.rows.map((row) => Math.max(
      safeTimestampToNumber(row.last_seen_at_ms, 'last_seen_at_ms'),
      row.closed_at_ms === null ? 0 : safeTimestampToNumber(row.closed_at_ms, 'closed_at_ms'),
    )),
  );
}

export async function reconcilePresenceInTransaction(
  client: PoolClient,
  userId: string,
  state: TimerState,
  nowMs: number,
): Promise<TimerState> {
  const tabs = await activeTabs(client, userId);
  const thresholdMs = nowMs - LEASE_DURATION_MS;
  const expiredTabs = tabs.filter(
    (tab) => safeTimestampToNumber(tab.last_seen_at_ms, 'last_seen_at_ms') <= thresholdMs,
  );

  if (tabs.length === 0) {
    const storedSignalMs = await latestStoredTabSignal(client, userId);
    if (storedSignalMs === null) {
      const materialized = materializeCountdownCompletion(state, nowMs);
      return { snapshot: { ...materialized.snapshot, serverNowMs: nowMs }, alarmClaimed: materialized.alarmClaimed };
    }
    const paused = pauseTimersAt(state, storedSignalMs);
    return { snapshot: { ...paused.snapshot, serverNowMs: nowMs }, alarmClaimed: paused.alarmClaimed };
  }

  if (expiredTabs.length === tabs.length && expiredTabs.length > 0) {
    const lastSignalMs = Math.max(
      ...expiredTabs.map((tab) => safeTimestampToNumber(tab.last_seen_at_ms, 'last_seen_at_ms')),
    );
    const paused = pauseTimersAt(state, lastSignalMs);
    await deleteExpiredTabs(client, userId, thresholdMs);
    return { snapshot: { ...paused.snapshot, serverNowMs: nowMs }, alarmClaimed: paused.alarmClaimed };
  }

  if (expiredTabs.length > 0) {
    await deleteExpiredTabs(client, userId, thresholdMs);
  }

  const materialized = materializeCountdownCompletion(state, nowMs);
  return { snapshot: { ...materialized.snapshot, serverNowMs: nowMs }, alarmClaimed: materialized.alarmClaimed };
}

export async function reconcilePresence(userId: string, nowMs: number): Promise<Snapshot> {
  requireSafeTimestamp(nowMs, 'nowMs');

  return withTransaction(async (client) => {
    const current = stateFromRow(await selectTimerState(client, userId), nowMs);
    const next = await reconcilePresenceInTransaction(client, userId, current, nowMs);
    if (next.snapshot.revision !== current.snapshot.revision) {
      await persistTimerState(client, userId, next);
    }
    return next.snapshot;
  });
}

export async function touchTab(
  userId: string,
  tabId: string,
  action: TabAction,
  nowMs: number,
): Promise<Snapshot> {
  requireTabId(tabId);
  if (action !== 'open' && action !== 'heartbeat' && action !== 'close') {
    throw new RangeError('Tab action is invalid.');
  }
  requireSafeTimestamp(nowMs, 'nowMs');

  return withTransaction(async (client) => {
    const current = stateFromRow(await selectTimerState(client, userId), nowMs);
    let next = await reconcilePresenceInTransaction(client, userId, current, nowMs);

    if (action === 'close') {
      const closed = await client.query(
        `UPDATE browser_tabs
         SET closed_at_ms = $3
         WHERE user_id = $1 AND tab_id = $2 AND closed_at_ms IS NULL`,
        [userId, tabId, nowMs],
      );
      if ((closed.rowCount ?? 0) > 0) {
        const remaining = await client.query(
          `SELECT 1 FROM browser_tabs
           WHERE user_id = $1 AND closed_at_ms IS NULL
           LIMIT 1`,
          [userId],
        );
        if (remaining.rowCount === 0) {
          const signals = await client.query<{ pause_at_ms: string | null }>(
            `SELECT MAX(GREATEST(last_seen_at_ms, COALESCE(closed_at_ms, last_seen_at_ms))) AS pause_at_ms
             FROM browser_tabs
             WHERE user_id = $1`,
            [userId],
          );
          const storedPauseAtMs = signals.rows[0]?.pause_at_ms;
          const pauseAtMs = storedPauseAtMs === null || storedPauseAtMs === undefined
            ? nowMs
            : Math.max(nowMs, safeTimestampToNumber(storedPauseAtMs, 'pause_at_ms'));
          next = pauseTimersAt(next, pauseAtMs);
        }
      }
    } else {
      await client.query(
        `INSERT INTO browser_tabs (user_id, tab_id, last_seen_at_ms, closed_at_ms)
         VALUES ($1, $2, $3, NULL)
         ON CONFLICT (user_id, tab_id)
         DO UPDATE SET last_seen_at_ms = GREATEST(browser_tabs.last_seen_at_ms, EXCLUDED.last_seen_at_ms),
                       closed_at_ms = NULL`,
        [userId, tabId, nowMs],
      );
    }

    if (next.snapshot.revision !== current.snapshot.revision) {
      await persistTimerState(client, userId, next);
    }
    return { ...next.snapshot, serverNowMs: nowMs };
  });
}

export async function claimCompletedAlarm(userId: string, runId: string): Promise<boolean> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(runId)) {
    return false;
  }

  return withTransaction(async (client) => {
    const nowMs = Date.now();
    const current = stateFromRow(await selectTimerState(client, userId), nowMs);
    const reconciled = await reconcilePresenceInTransaction(client, userId, current, nowMs);
    if (reconciled.snapshot.revision !== current.snapshot.revision) {
      await persistTimerState(client, userId, reconciled);
    }

    const result = await client.query(
      `UPDATE timer_states
       SET alarm_claimed = TRUE
       WHERE user_id = $1
         AND completed_run_id = $2
         AND alarm_claimed = FALSE`,
      [userId, runId],
    );
    return (result.rowCount ?? 0) === 1;
  });
}

export const claimAlarm = claimCompletedAlarm;
