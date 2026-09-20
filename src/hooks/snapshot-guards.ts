import type { Command, Snapshot } from '../features/timer/types';

export type CountdownObservation = {
  runId: string;
  valueMs: number;
  started: boolean;
};

export function canAcceptSnapshot(
  current: Snapshot | null,
  incoming: Snapshot,
  commandPending = false,
): boolean {
  if (commandPending) return false;
  if (current === null || incoming.revision > current.revision) return true;
  return incoming.revision === current.revision && incoming.serverNowMs >= current.serverNowMs;
}

export function isResetApplied(snapshot: Snapshot, command: Command): boolean {
  if (command.type !== 'reset') return false;
  if (command.timer === 'up') return snapshot.up.valueMs === 0 && snapshot.up.startedAtMs === null;
  return snapshot.down.valueMs === snapshot.durationMs
    && snapshot.down.startedAtMs === null
    && snapshot.completedRunId === null;
}

export function shouldClaimExpiredCountdown(
  snapshot: Snapshot,
  previous: CountdownObservation | null,
): boolean {
  if (snapshot.down.startedAtMs === null || snapshot.down.valueMs > 0) return false;
  if (snapshot.completedRunId === snapshot.downRunId) return false;
  if (!previous || previous.runId !== snapshot.downRunId) return true;
  return previous.started && previous.valueMs > 0;
}
