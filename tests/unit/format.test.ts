import { describe, expect, it } from 'vitest';

import { formatDuration } from '../../src/features/timer/format';

describe('formatDuration', () => {
  it('formats durations beyond 24 hours', () => {
    expect(formatDuration(90_061_000)).toBe('25:01:01');
  });

  it('clamps invalid duration input to zero', () => {
    expect(formatDuration(Number.NaN)).toBe('00:00:00');
    expect(formatDuration(-1)).toBe('00:00:00');
  });
});
