import type { PoolClient } from 'pg';

import { readValue } from '../../features/timer/engine';
import type { Snapshot } from '../../features/timer/types';

const MAX_SAFE_BIGINT = BigInt(Number.MAX_SAFE_INTEGER);

export type TimerStateRow = {
  revision: string;
  up_value_ms: string;
  up_started_at_ms: string | null;
  down_value_ms: string;
  down_started_at_ms: string | null;
  duration_ms: string;
  sound_enabled: boolean;
  down_run_id: string;
  completed_run_id: string | null;
  alarm_claimed: boolean;
};

export type TimerState = {
  snapshot: Snapshot;
  alarmClaimed: boolean;
};

function safeBigIntToNumber(value: string | number | bigint | null, field: string): number | null {
  if (value === null) {
    return null;
  }

  let integer: bigint;
  try {
    integer = typeof value === 'bigint' ? value : BigInt(value);
  } catch {
    throw new Error(`Invalid BIGINT value for ${field}.`);
  }

  if (integer < 0 || integer > MAX_SAFE_BIGINT) {
    throw new Error(`BIGINT value for ${field} is outside the safe JavaScript range.`);
  }
  return Number(integer);
}

export function safeTimestampToNumber(value: string | number | bigint, field: string): number {
  const result = safeBigIntToNumber(value, field);
  if (result === null) {
    throw new Error(`${field} cannot be null.`);
  }
  return result;
}

export function snapshotFromRow(row: TimerStateRow, nowMs: number): Snapshot {
  return {
    revision: safeBigIntToNumber(row.revision, 'revision')!,
    serverNowMs: nowMs,
    up: {
      valueMs: safeBigIntToNumber(row.up_value_ms, 'up_value_ms')!,
      startedAtMs: safeBigIntToNumber(row.up_started_at_ms, 'up_started_at_ms'),
    },
    down: {
      valueMs: safeBigIntToNumber(row.down_value_ms, 'down_value_ms')!,
      startedAtMs: safeBigIntToNumber(row.down_started_at_ms, 'down_started_at_ms'),
    },
    durationMs: safeBigIntToNumber(row.duration_ms, 'duration_ms')!,
    soundEnabled: row.sound_enabled,
    downRunId: row.down_run_id,
    completedRunId: row.completed_run_id,
  };
}

export async function selectTimerState(client: PoolClient, userId: string): Promise<TimerStateRow> {
  const result = await client.query<TimerStateRow>(
    `SELECT revision, up_value_ms, up_started_at_ms,
            down_value_ms, down_started_at_ms, duration_ms,
            sound_enabled, down_run_id, completed_run_id, alarm_claimed
     FROM timer_states
     WHERE user_id = $1
     FOR UPDATE`,
    [userId],
  );
  const row = result.rows[0];
  if (!row) {
    throw new Error('Timer state was not found.');
  }
  return row;
}

export function stateFromRow(row: TimerStateRow, nowMs: number): TimerState {
  return {
    snapshot: snapshotFromRow(row, nowMs),
    alarmClaimed: row.alarm_claimed,
  };
}

export async function persistTimerState(client: PoolClient, userId: string, state: TimerState): Promise<void> {
  const { snapshot, alarmClaimed } = state;
  await client.query(
    `UPDATE timer_states
     SET revision = $2,
         up_value_ms = $3,
         up_started_at_ms = $4,
         down_value_ms = $5,
         down_started_at_ms = $6,
         duration_ms = $7,
         sound_enabled = $8,
         down_run_id = $9,
         completed_run_id = $10,
         alarm_claimed = $11
     WHERE user_id = $1`,
    [
      userId,
      snapshot.revision,
      snapshot.up.valueMs,
      snapshot.up.startedAtMs,
      snapshot.down.valueMs,
      snapshot.down.startedAtMs,
      snapshot.durationMs,
      snapshot.soundEnabled,
      snapshot.downRunId,
      snapshot.completedRunId,
      alarmClaimed,
    ],
  );
}

export function materializeCountdownCompletion(state: TimerState, nowMs: number): TimerState {
  const { snapshot } = state;
  if (snapshot.down.startedAtMs === null || readValue(snapshot.down, 'down', nowMs) !== 0) {
    return { snapshot: { ...snapshot, serverNowMs: nowMs }, alarmClaimed: state.alarmClaimed };
  }

  return {
    snapshot: {
      ...snapshot,
      revision: snapshot.revision + 1,
      serverNowMs: nowMs,
      down: { valueMs: 0, startedAtMs: null },
      completedRunId: snapshot.downRunId,
    },
    alarmClaimed: false,
  };
}

export function pauseTimersAt(state: TimerState, pauseAtMs: number): TimerState {
  const { snapshot } = state;
  let changed = false;
  const next = {
    ...snapshot,
    revision: snapshot.revision + 1,
    serverNowMs: pauseAtMs,
    up: { ...snapshot.up },
    down: { ...snapshot.down },
  };

  if (snapshot.up.startedAtMs !== null) {
    next.up = { valueMs: readValue(snapshot.up, 'up', pauseAtMs), startedAtMs: null };
    changed = true;
  }

  if (snapshot.down.startedAtMs !== null) {
    const valueMs = readValue(snapshot.down, 'down', pauseAtMs);
    next.down = { valueMs, startedAtMs: null };
    if (valueMs === 0) {
      next.completedRunId = snapshot.downRunId;
    }
    changed = true;
  }

  return changed
    ? {
        snapshot: next,
        alarmClaimed: next.completedRunId === snapshot.completedRunId ? state.alarmClaimed : false,
      }
    : { snapshot: { ...snapshot, serverNowMs: pauseAtMs }, alarmClaimed: state.alarmClaimed };
}
