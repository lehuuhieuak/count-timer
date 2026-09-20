export type TimerKind = 'up' | 'down';

export type Timer = {
  valueMs: number;
  startedAtMs: number | null;
};

export type Snapshot = {
  revision: number;
  serverNowMs: number;
  up: Timer;
  down: Timer;
  durationMs: number;
  soundEnabled: boolean;
  downRunId: string;
  completedRunId: string | null;
};

export type Command =
  | { type: 'start' | 'pause' | 'reset'; timer: TimerKind }
  | { type: 'set-duration'; durationMs: number }
  | { type: 'set-sound'; enabled: boolean };
