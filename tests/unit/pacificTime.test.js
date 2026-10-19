import { describe, it, expect } from 'vitest';
import { startOfPacificDay, nextPacificReset } from '../../src/utils/pacificTime.js';

const iso = (d) => d.toISOString();
const startOf = (when) => iso(startOfPacificDay(new Date(when)));
const resetAfter = (when) => iso(nextPacificReset(new Date(when)));

describe('startOfPacificDay', () => {
  it('is 07:00 UTC in summer (daylight time)', () => {
    expect(startOf('2026-10-07T11:48:33.876Z')).toBe('2026-10-07T07:00:00.000Z');
  });

  it('is 08:00 UTC in winter (standard time)', () => {
    expect(startOf('2026-12-15T12:00:00.000Z')).toBe('2026-12-15T08:00:00.000Z');
  });

  it('switches exactly at Pacific midnight, and drops the milliseconds', () => {
    expect(startOf('2026-10-07T07:00:00.000Z')).toBe('2026-10-07T07:00:00.000Z');
    expect(startOf('2026-10-07T06:59:59.999Z')).toBe('2026-10-06T07:00:00.000Z');
  });

  it('is right on the day the clocks go back (a 25-hour day, 1 November 2026)', () => {
    expect(startOf('2026-11-01T12:00:00.000Z')).toBe('2026-11-01T07:00:00.000Z');
    expect(startOf('2026-11-02T07:30:00.000Z')).toBe('2026-11-01T07:00:00.000Z'); // 23:30 that evening
    expect(startOf('2026-11-02T12:00:00.000Z')).toBe('2026-11-02T08:00:00.000Z');
  });

  it('is right on the day the clocks go forward (a 23-hour day, 8 March 2026)', () => {
    expect(startOf('2026-03-08T20:00:00.000Z')).toBe('2026-03-08T08:00:00.000Z');
    expect(startOf('2026-03-09T12:00:00.000Z')).toBe('2026-03-09T07:00:00.000Z');
  });
});

describe('nextPacificReset', () => {
  it('is the next Pacific midnight', () => {
    expect(resetAfter('2026-10-07T11:48:33.876Z')).toBe('2026-10-08T07:00:00.000Z');
  });

  it('is right across the clock changes', () => {
    expect(resetAfter('2026-10-31T20:00:00.000Z')).toBe('2026-11-01T07:00:00.000Z');
    expect(resetAfter('2026-11-01T12:00:00.000Z')).toBe('2026-11-02T08:00:00.000Z'); // after a 25-hour day
    expect(resetAfter('2026-03-07T20:00:00.000Z')).toBe('2026-03-08T08:00:00.000Z');
  });

  it('is always later than now, and within 25 hours', () => {
    for (const when of ['2026-03-08T09:59:59.000Z', '2026-03-08T10:00:00.000Z', '2026-11-01T08:59:59.000Z', '2026-11-01T09:00:00.000Z']) {
      const now = new Date(when);
      const gap = nextPacificReset(now).getTime() - now.getTime();
      expect(gap).toBeGreaterThan(0);
      expect(gap).toBeLessThanOrEqual(25 * 60 * 60 * 1000);
    }
  });
});