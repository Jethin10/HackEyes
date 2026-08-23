import { describe, expect, it } from 'vitest';
import { hoursUntil } from '../../src/util/time.js';

describe('hoursUntil', () => {
  it('respects the +05:30 offset — the 5.5-hour bug test', () => {
    // Deadline: 2026-09-02T23:59:00+05:30 == 2026-09-02T18:29:00Z.
    const now = new Date('2026-09-02T18:29:00Z');
    expect(hoursUntil('2026-09-02T23:59:00+05:30', now)).toBeCloseTo(0, 5);
    // A parser that ignored "+05:30" and compared wall clocks would answer
    // -5.5 here (23:59 "UTC" is already past). The offset must win.
    const laterUtc = new Date('2026-09-02T23:59:00Z');
    expect(hoursUntil('2026-09-02T23:59:00+05:30', laterUtc)).toBeCloseTo(
      -5.5,
      5,
    );
  });

  it('handles Z-suffixed timestamps', () => {
    const now = new Date('2026-09-01T00:00:00Z');
    expect(hoursUntil('2026-09-02T12:00:00Z', now)).toBeCloseTo(36, 5);
  });

  it('handles explicit +00:00 offsets', () => {
    const now = new Date('2026-09-01T10:00:00Z');
    expect(hoursUntil('2026-09-01T20:00:00+00:00', now)).toBeCloseTo(10, 5);
  });

  it('returns fractional hours across a half-hour offset boundary', () => {
    const now = new Date('2026-09-02T06:00:00Z'); // 11:30 IST
    // deadline == 18:29Z; diff = 12h29m
    expect(hoursUntil('2026-09-02T23:59:00+05:30', now)).toBeCloseTo(
      12.4833333,
      4,
    );
  });

  it('throws on a naive timestamp instead of guessing a zone', () => {
    const now = new Date('2026-09-02T12:00:00Z');
    expect(() =>
      hoursUntil('2026-09-02T23:59:00', now),
    ).toThrow(/explicit UTC offset/);
  });
});
