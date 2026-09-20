import { describe, expect, it } from 'vitest';

import { canAcceptSnapshot, shouldClaimExpiredCountdown } from '../../src/hooks/snapshot-guards';
import type { Snapshot } from '../../src/features/timer/types';

const snapshot = (overrides: Partial<Snapshot> = {}): Snapshot => ({
  revision: 1,
  serverNowMs: 1_000,
  up: { valueMs: 0, startedAtMs: null },
  down: { valueMs: 0, startedAtMs: 1_000 },
  durationMs: 1_000,
  soundEnabled: true,
  downRunId: 'run-1',
  completedRunId: null,
  ...overrides,
});

describe('snapshot guards', () => {
  it('rejects a lower revision and reads while a command is pending', () => {
    expect(canAcceptSnapshot(snapshot({ revision: 3 }), snapshot({ revision: 2 }))).toBe(false);
    expect(canAcceptSnapshot(snapshot({ revision: 3 }), snapshot({ revision: 4 }), true)).toBe(false);
    expect(canAcceptSnapshot(snapshot({ revision: 3 }), snapshot({ revision: 4 }))).toBe(true);
  });

  it('claims a run that was already expired when the first snapshot rendered', () => {
    expect(shouldClaimExpiredCountdown(snapshot(), null)).toBe(true);
  });

  it('does not claim an already materialized historical completion', () => {
    expect(shouldClaimExpiredCountdown(snapshot({ completedRunId: 'run-1' }), null)).toBe(false);
  });

  it('claims only when a previously visible run crosses zero', () => {
    expect(shouldClaimExpiredCountdown(snapshot(), { runId: 'run-1', valueMs: 1, started: true })).toBe(true);
    expect(shouldClaimExpiredCountdown(snapshot(), { runId: 'run-1', valueMs: 0, started: true })).toBe(false);
  });
});
