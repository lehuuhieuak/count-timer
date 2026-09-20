import type { Timer, TimerKind } from './types';

export function interpolateTimer(
  timer: Timer,
  kind: TimerKind,
  serverNowMs: number,
  receivedMonotonicMs: number,
  nowMonotonicMs: number,
): number {
  const elapsedSinceReceive = Math.max(0, nowMonotonicMs - receivedMonotonicMs);
  const elapsedSinceStart = timer.startedAtMs === null
    ? 0
    : Math.max(0, serverNowMs + elapsedSinceReceive - timer.startedAtMs);
  return kind === 'up'
    ? timer.valueMs + elapsedSinceStart
    : Math.max(0, timer.valueMs - elapsedSinceStart);
}

export function formatDisplayDuration(ms: number, kind: TimerKind): string {
  const displayMs = kind === 'down' ? Math.ceil(Math.max(0, ms) / 1_000) * 1_000 : Math.max(0, ms);
  const seconds = Math.floor(displayMs / 1_000);
  const hours = Math.floor(seconds / 3_600);
  const minutes = Math.floor(seconds / 60) % 60;
  const remainingSeconds = seconds % 60;
  return [hours, minutes, remainingSeconds]
    .map((value) => String(value).padStart(2, '0'))
    .join(':');
}
