import { describe, expect, it } from 'vitest';
import { busyness, greeting, peakHourSentence, WIB_HOUR } from './insight';

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

describe('peakHourSentence', () => {
  it('adds the lunch remark only at 11–14', () => {
    expect(peakHourSentence(12)).toBe('Jam 12 paling rame. Pas jam makan siang.');
    expect(peakHourSentence(16)).toBe('Jam 16 paling rame.');
  });
});
