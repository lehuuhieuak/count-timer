import type { Snapshot } from '../features/timer/types';

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
  return current === null || incoming.revision >= current.revision;
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
