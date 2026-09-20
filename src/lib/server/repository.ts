import { randomUUID } from 'node:crypto';

import type { PoolClient } from 'pg';

import { applyCommand, MAX_DURATION_MS, MIN_DURATION_MS } from '../../features/timer/engine';
import type { Command, Snapshot, TimerKind } from '../../features/timer/types';
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

export class InvalidCommandError extends Error {
  readonly statusCode = 400;

  constructor(message = 'Invalid timer command.') {
    super(message);
    this.name = 'InvalidCommandError';
  }
}

export class RevisionConflictError extends Error {
  readonly statusCode = 409;
  readonly snapshot: Snapshot;

  constructor(snapshot: Snapshot) {
    super('The timer snapshot is out of date.');
    this.name = 'RevisionConflictError';
    this.snapshot = snapshot;
  }
}

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

function requireRecord(value: unknown, field: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new InvalidCommandError(`${field} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function requireTimerKind(value: unknown): TimerKind {
  if (value !== 'up' && value !== 'down') {
    throw new InvalidCommandError('Timer must be up or down.');
  }
  return value;
}

function validateCommand(command: unknown): asserts command is Command {
  const record = requireRecord(command, 'command');
  if (typeof record.type !== 'string') {
    throw new InvalidCommandError('Command type is required.');
  }

  if (record.type === 'start' || record.type === 'pause' || record.type === 'reset') {
    requireTimerKind(record.timer);
    return;
  }

  if (record.type === 'set-duration') {
    if (
      typeof record.durationMs !== 'number' ||
      !Number.isSafeInteger(record.durationMs) ||
      record.durationMs < MIN_DURATION_MS ||
      record.durationMs > MAX_DURATION_MS
    ) {
      throw new InvalidCommandError('Nhập thời lượng từ 1 giây đến 99:59:59.');
    }
    return;
  }

  if (record.type === 'set-sound') {
    if (typeof record.enabled !== 'boolean') {
      throw new InvalidCommandError('Sound setting must be boolean.');
    }
    return;
  }

  throw new InvalidCommandError('Unknown timer command.');
}

function snapshotFromRow(row: TimerStateRow, nowMs: number): Snapshot {
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

async function selectTimerState(client: PoolClient, userId: string): Promise<TimerStateRow> {
  const result = await client.query<TimerStateRow>(
    `SELECT revision, up_value_ms, up_started_at_ms,
            down_value_ms, down_started_at_ms, duration_ms,
            sound_enabled, down_run_id, completed_run_id
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

  return snapshotFromRow(row, nowMs);
}

export async function executeCommand(
  userId: string,
  expectedRevision: number,
  command: Command,
  nowMs: number,
): Promise<Snapshot> {
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) {
    throw new InvalidCommandError('Revision must be a non-negative safe integer.');
  }
  requireSafeTimestamp(nowMs, 'nowMs');
  validateCommand(command);

  return withTransaction(async (client) => {
    const current = snapshotFromRow(await selectTimerState(client, userId), nowMs);
    if (current.revision !== expectedRevision) {
      throw new RevisionConflictError(current);
    }

    let next: Snapshot;
    try {
      next = applyCommand(current, command, nowMs, randomUUID());
    } catch (error) {
      throw new InvalidCommandError(error instanceof Error ? error.message : 'Invalid timer command.');
    }

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
           completed_run_id = $10
       WHERE user_id = $1`,
      [
        userId,
        next.revision,
        next.up.valueMs,
        next.up.startedAtMs,
        next.down.valueMs,
        next.down.startedAtMs,
        next.durationMs,
        next.soundEnabled,
        next.downRunId,
        next.completedRunId,
      ],
    );

    return next;
  });
}
