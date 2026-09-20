import { describe, expect, it } from 'vitest';

import { applyCommand, readValue } from '../../src/features/timer/engine';
import type { Snapshot } from '../../src/features/timer/types';

const snapshot = (): Snapshot => ({
  revision: 3,
  serverNowMs: 1_000,
  up: { valueMs: 2_000, startedAtMs: null },
  down: { valueMs: 2_000, startedAtMs: null },
  durationMs: 5_000,
  soundEnabled: true,
  downRunId: 'run-1',
  completedRunId: null,
});

describe('readValue', () => {
  it('adds elapsed time for a running count-up timer', () => {
    expect(readValue({ valueMs: 2_000, startedAtMs: 1_000 }, 'up', 4_000)).toBe(5_000);
  });

  it('clamps a running countdown at zero', () => {
    expect(readValue({ valueMs: 2_000, startedAtMs: 1_000 }, 'down', 4_000)).toBe(0);
  });

  it('does not add time while paused', () => {
    expect(readValue({ valueMs: 2_000, startedAtMs: null }, 'up', 9_000)).toBe(2_000);
  });

  it('saturates a finite count-up calculation that would overflow', () => {
    const timer = { valueMs: Number.MAX_VALUE, startedAtMs: 0 };
    const value = readValue(timer, 'up', Number.MAX_VALUE);
    const paused = applyCommand(
      { ...snapshot(), up: timer },
      { type: 'pause', timer: 'up' },
      Number.MAX_VALUE,
      'run-2',
    );

    expect(value).toBe(Number.MAX_VALUE);
    expect(paused.up).toEqual({ valueMs: Number.MAX_VALUE, startedAtMs: null });
    expect(Number.isFinite(paused.up.valueMs)).toBe(true);
  });
});

describe('applyCommand', () => {
  it('pauses at the calculated value and resumes from the new timestamp', () => {
    const running = { ...snapshot(), up: { valueMs: 2_000, startedAtMs: 1_000 } };
    const paused = applyCommand(running, { type: 'pause', timer: 'up' }, 4_000, 'run-2');
    const resumed = applyCommand(paused, { type: 'start', timer: 'up' }, 9_000, 'run-3');

    expect(paused.up).toEqual({ valueMs: 5_000, startedAtMs: null });
    expect(readValue(resumed.up, 'up', 10_000)).toBe(6_000);
  });

  it('resets count-up to a stopped zero value', () => {
    const result = applyCommand(
      { ...snapshot(), up: { valueMs: 5_000, startedAtMs: 1_000 } },
      { type: 'reset', timer: 'up' },
      4_000,
      'run-2',
    );

    expect(result.up).toEqual({ valueMs: 0, startedAtMs: null });
  });

  it('restarts an exhausted countdown from its duration with a fresh run ID', () => {
    const result = applyCommand(
      { ...snapshot(), down: { valueMs: 0, startedAtMs: null }, downRunId: 'run-1' },
      { type: 'start', timer: 'down' },
      4_000,
      'run-2',
    );

    expect(result.down).toEqual({ valueMs: 5_000, startedAtMs: 4_000 });
    expect(result.downRunId).toBe('run-2');
    expect(result.completedRunId).toBeNull();
  });

  it('restarts a running countdown that expired before the start command', () => {
    const result = applyCommand(
      { ...snapshot(), down: { valueMs: 5_000, startedAtMs: 1_000 }, downRunId: 'run-1' },
      { type: 'start', timer: 'down' },
      7_000,
      'run-2',
    );

    expect(result.down).toEqual({ valueMs: 5_000, startedAtMs: 7_000 });
    expect(result.downRunId).toBe('run-2');
  });

  it('leaves a still-running countdown on its existing run', () => {
    const result = applyCommand(
      { ...snapshot(), down: { valueMs: 5_000, startedAtMs: 1_000 }, downRunId: 'run-1' },
      { type: 'start', timer: 'down' },
      2_000,
      'run-2',
    );

    expect(result.down).toEqual({ valueMs: 5_000, startedAtMs: 1_000 });
    expect(result.downRunId).toBe('run-1');
  });

  it('rejects changing the duration while countdown is running', () => {
    expect(() => applyCommand(
      { ...snapshot(), down: { valueMs: 4_000, startedAtMs: 1_000 } },
      { type: 'set-duration', durationMs: 6_000 },
      2_000,
      'run-2',
    )).toThrow('Tạm dừng trước khi đổi thời lượng.');
  });

  it('rejects durations outside the supported finite range', () => {
    expect(() => applyCommand(snapshot(), { type: 'set-duration', durationMs: 999 }, 2_000, 'run-2')).toThrow();
    expect(() => applyCommand(snapshot(), { type: 'set-duration', durationMs: Number.POSITIVE_INFINITY }, 2_000, 'run-2')).toThrow();
  });
});
