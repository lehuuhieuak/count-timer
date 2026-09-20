import { describe, expect, it } from 'vitest';

import { formatDisplayDuration, interpolateTimer } from '../../src/features/timer/client-time';

describe('display time', () => {
  it('floors elapsed seconds and keeps hours above 24', () => {
    expect(formatDisplayDuration(125 * 3_600_000 + 3_000 + 900, 'up')).toBe('125:00:03');
  });

  it('ceils remaining seconds until the countdown has actually ended', () => {
    expect(formatDisplayDuration(500, 'down')).toBe('00:00:01');
    expect(formatDisplayDuration(0, 'down')).toBe('00:00:00');
  });

  it('interpolates from the received monotonic timestamp', () => {
    expect(interpolateTimer({ valueMs: 2_000, startedAtMs: 10_000 }, 'down', 10_000, 100, 500)).toBe(1_600);
  });
});
