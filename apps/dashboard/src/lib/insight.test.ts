import { describe, expect, it } from 'vitest';
import { busyness, greeting, peakHourSentence, revenueBeforeHour, WIB_HOUR } from './insight';

describe('greeting', () => {
  it.each([
    [4, 'pagi'],
    [10, 'pagi'],
    [11, 'siang'],
    [14, 'siang'],
    [15, 'sore'],
    [17, 'sore'],
    [18, 'malam'],
    [3, 'malam'],
  ])('hour %i is %s', (h, word) => {
    expect(greeting('Albert Simanjuntak', h)).toBe(`Selamat ${word}, Pak Albert`);
  });
  it('falls back without a name', () => {
    expect(greeting('  ', 9)).toBe('Halo!');
    expect(greeting(undefined, 9)).toBe('Halo!');
  });
  it('converts a UTC instant to the WIB hour', () => {
    expect(WIB_HOUR(new Date('2026-10-26T20:30:00Z'))).toBe(3);
  });
});

describe('busyness', () => {
  const week = [100, 100, 100, 100, 100, 100, 100];
  it('applies the ±15% rule', () => {
    expect(busyness(115, week)).toBe('rame');
    expect(busyness(114, week)).toBe('normal');
    expect(busyness(86, week)).toBe('normal');
    expect(busyness(85, week)).toBe('sepi');
  });
  it('hides the sentence without a full week of data', () => {
    expect(busyness(500, [100, 100, 100])).toBeNull();
    expect(busyness(500, [0, 0, 100, 100, 100, 100, 100])).toBeNull();
    expect(busyness(500, [0, 0, 0, 0, 0, 0, 0])).toBeNull();
  });
});

describe('revenueBeforeHour', () => {
  // Each previous day sells 10.000 per hour from 08.00 WIB (01:00Z) for ten hours.
  const days = Array.from({ length: 7 }, (_, n) => n);
  const points = days.flatMap((n) =>
    Array.from({ length: 10 }, (_, h) => ({
      bucket_start: new Date(Date.UTC(2026, 9, 19 + n, 1 + h)).toISOString(),
      revenue: 10_000,
    })),
  );
  it('sums only buckets before the current WIB hour, per day', () => {
    expect(revenueBeforeHour(points, '2026-10-19', 7, 10)).toEqual(Array(7).fill(20_000));
    expect(revenueBeforeHour(points, '2026-10-19', 7, 7)).toEqual(Array(7).fill(0));
  });
  it('a normal morning is "normal", not "sepi" as against full-day averages', () => {
    const sameHours = revenueBeforeHour(points, '2026-10-19', 7, 10);
    expect(busyness(21_000, sameHours)).toBe('normal');
    // The old comparison against full days (100.000) would have said sepi.
    expect(busyness(21_000, Array(7).fill(100_000))).toBe('sepi');
  });
});

describe('peakHourSentence', () => {
  it('adds the lunch remark only at 11–14', () => {
    expect(peakHourSentence(12)).toBe('Jam 12 paling rame. Pas jam makan siang.');
    expect(peakHourSentence(16)).toBe('Jam 16 paling rame.');
  });
});
