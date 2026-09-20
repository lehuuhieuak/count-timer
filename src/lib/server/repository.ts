import { randomUUID } from 'node:crypto';

import type { PoolClient } from 'pg';

import { applyCommand, MAX_DURATION_MS, MIN_DURATION_MS } from '../../features/timer/engine';
import type { Command, Snapshot, TimerKind } from '../../features/timer/types';
import { getPool, withTransaction } from './db';
import { reconcilePresenceInTransaction, claimCompletedAlarm } from './leases';
import {
  persistTimerState,
  selectTimerState,
  stateFromRow,
} from './timer-state';

const DEFAULT_DURATION_MS = 1_500_000;
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
       down_run_id, completed_run_id, alarm_claimed
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
    [userId, 0, 0, null, DEFAULT_DURATION_MS, null, DEFAULT_DURATION_MS, true, randomUUID(), null, false],
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

  return withTransaction(async (client) => {
    const current = stateFromRow(await selectTimerState(client, userId), nowMs);
    const next = await reconcilePresenceInTransaction(client, userId, current, nowMs);
    if (next.snapshot.revision !== current.snapshot.revision) {
      await persistTimerState(client, userId, next);
    }
    return next.snapshot;
  });
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
    const stored = stateFromRow(await selectTimerState(client, userId), nowMs);
    const reconciled = await reconcilePresenceInTransaction(client, userId, stored, nowMs);
    if (reconciled.snapshot.revision !== stored.snapshot.revision) {
      await persistTimerState(client, userId, reconciled);
    }

    const current = reconciled.snapshot;
    if (current.revision !== expectedRevision) {
      throw new RevisionConflictError(current);
    }

    let next: Snapshot;
    try {
      next = applyCommand(current, command, nowMs, randomUUID());
    } catch (error) {
      throw new InvalidCommandError(error instanceof Error ? error.message : 'Invalid timer command.');
    }

    const nextState = {
      snapshot: next,
      alarmClaimed:
        reconciled.alarmClaimed && next.completedRunId === current.completedRunId,
    };
    await persistTimerState(client, userId, nextState);

    return next;
  });
}

export async function claimAlarm(userId: string, runId: string): Promise<boolean> {
  return claimCompletedAlarm(userId, runId);
}
