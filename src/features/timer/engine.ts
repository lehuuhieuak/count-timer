import type { Command, Snapshot, Timer, TimerKind } from './types';

export const MIN_DURATION_MS = 1_000;
export const MAX_DURATION_MS = 359_999_000;

function assertFiniteNonNegative(value: number, name: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(`${name} must be a non-negative finite number.`);
  }
}

function assertTimer(timer: Timer): void {
  assertFiniteNonNegative(timer.valueMs, 'Timer value');
  if (timer.startedAtMs !== null) {
    assertFiniteNonNegative(timer.startedAtMs, 'Timer start time');
  }
}

function assertDuration(durationMs: number): void {
  if (!Number.isInteger(durationMs) || durationMs < MIN_DURATION_MS || durationMs > MAX_DURATION_MS) {
    throw new RangeError('Nhập thời lượng từ 1 giây đến 99:59:59.');
  }
}

function nextSnapshot(snapshot: Snapshot, nowMs: number): Snapshot {
  assertFiniteNonNegative(nowMs, 'Current time');
  assertTimer(snapshot.up);
  assertTimer(snapshot.down);
  assertDuration(snapshot.durationMs);

  return {
    ...snapshot,
    revision: snapshot.revision + 1,
    serverNowMs: nowMs,
    up: { ...snapshot.up },
    down: { ...snapshot.down },
  };
}

export function readValue(timer: Timer, kind: TimerKind, nowMs: number): number {
  assertTimer(timer);
  assertFiniteNonNegative(nowMs, 'Current time');

  const delta = timer.startedAtMs === null ? 0 : Math.max(0, nowMs - timer.startedAtMs);
  return kind === 'up' ? timer.valueMs + delta : Math.max(0, timer.valueMs - delta);
}

export function applyCommand(
  snapshot: Snapshot,
  command: Command,
  nowMs: number,
  nextRunId: string,
): Snapshot {
  const result = nextSnapshot(snapshot, nowMs);

  if (command.type === 'set-sound') {
    result.soundEnabled = command.enabled;
    return result;
  }

  if (command.type === 'set-duration') {
    assertDuration(command.durationMs);
    if (result.down.startedAtMs !== null) {
      throw new Error('Tạm dừng trước khi đổi thời lượng.');
    }
    result.durationMs = command.durationMs;
    result.down = { valueMs: command.durationMs, startedAtMs: null };
    return result;
  }

  const timer = result[command.timer];
  if (command.type === 'reset') {
    result[command.timer] = {
      valueMs: command.timer === 'up' ? 0 : result.durationMs,
      startedAtMs: null,
    };
    return result;
  }

  if (command.type === 'pause') {
    if (timer.startedAtMs !== null) {
      result[command.timer] = {
        valueMs: readValue(timer, command.timer, nowMs),
        startedAtMs: null,
      };
    }
    return result;
  }

  if (timer.startedAtMs !== null) {
    return result;
  }

  if (command.timer === 'down' && timer.valueMs === 0) {
    result.down = { valueMs: result.durationMs, startedAtMs: nowMs };
    result.downRunId = nextRunId;
    result.completedRunId = null;
    return result;
  }

  result[command.timer] = { valueMs: timer.valueMs, startedAtMs: nowMs };
  return result;
}
