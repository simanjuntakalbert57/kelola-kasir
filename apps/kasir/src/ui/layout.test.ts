import { describe, expect, it } from 'vitest';
import { COMPACT_HEIGHT, COMPACT_KEY, isCompactHeight, keyHeightFor } from './layout';

describe('keypad sizing', () => {
  it('uses compact keys on 360x640 and normal keys on 360x800', () => {
    expect(keyHeightFor(640)).toBe(COMPACT_KEY);
    expect(keyHeightFor(800)).toBe(60);
  });

  it('switches exactly at the threshold', () => {
    expect(isCompactHeight(COMPACT_HEIGHT - 1)).toBe(true);
    expect(isCompactHeight(COMPACT_HEIGHT)).toBe(false);
  });
});
