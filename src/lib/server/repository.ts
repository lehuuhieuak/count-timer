import { randomUUID } from 'node:crypto';

import type { PoolClient } from 'pg';

import type { Snapshot } from '../../features/timer/types';
import { getPool, withTransaction } from './db';

const DEFAULT_DURATION_MS = 1_500_000;
const MAX_SAFE_BIGINT = BigInt(Number.MAX_SAFE_INTEGER);

type TimerStateRow = {
  revision: string;
  up_value_ms: string;
  up_started_at_ms: string | null;
  down_value_ms: string;
  down_started_at_ms: string | null;
  duration_ms: string;
  sound_enabled: boolean;
  down_run_id: string;
  completed_run_id: string | null;
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

function requireSafeTimestamp(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${field} must be a non-negative safe integer.`);
  }
}

export async function createAnonymousUser(userId: string, hashedToken: Buffer): Promise<void> {
  await withTransaction(async (client) => {
    await client.query(
      `INSERT INTO anonymous_users (id, token_hash)
       VALUES ($1, $2)`,
      [userId, hashedToken],
    );
    await insertInitialTimer(client, userId);
  });
}

async function insertInitialTimer(client: PoolClient, userId: string): Promise<void> {
  await client.query(
    `INSERT INTO timer_states (
       user_id, revision, up_value_ms, up_started_at_ms,
       down_value_ms, down_started_at_ms, duration_ms, sound_enabled,
       down_run_id, completed_run_id
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [userId, 0, 0, null, DEFAULT_DURATION_MS, null, DEFAULT_DURATION_MS, true, randomUUID(), null],
  );
}

export async function findUserIdByTokenHash(hashedToken: Buffer): Promise<string | null> {
  const result = await getPool().query<{ id: string }>(
    `SELECT id FROM anonymous_users WHERE token_hash = $1`,
    [hashedToken],
  );
  return result.rows[0]?.id ?? null;
}

export async function readSnapshot(userId: string, nowMs: number): Promise<Snapshot> {
  requireSafeTimestamp(nowMs, 'nowMs');
  const result = await getPool().query<TimerStateRow>(
    `SELECT revision, up_value_ms, up_started_at_ms,
            down_value_ms, down_started_at_ms, duration_ms,
            sound_enabled, down_run_id, completed_run_id
     FROM timer_states
     WHERE user_id = $1`,
    [userId],
  );
  const row = result.rows[0];
  if (!row) {
    throw new Error('Timer state was not found.');
  }

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
