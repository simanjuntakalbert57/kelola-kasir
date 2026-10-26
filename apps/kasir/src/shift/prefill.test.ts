import { describe, expect, it } from 'vitest';
import { createMemoryStore } from '../lib/storage';
import { uuidv7 } from '../lib/uuid';
import {
  appendDigit,
  digitsToRupiah,
  loadSuggestedOpeningCash,
  openShiftInput,
  rememberClosingCash,
} from './prefill';

describe('opening cash prefill', () => {
  it('is empty until a shift was closed on this device, then suggests that cash', async () => {
    const store = createMemoryStore();
    expect(await loadSuggestedOpeningCash(store)).toBeNull();
    await rememberClosingCash(store, 200_000);
    expect(await loadSuggestedOpeningCash(store)).toBe(200_000);
  });
});

describe('keypad input', () => {
  it('appends digits, strips leading zeros, supports backspace and a length cap', () => {
    expect(appendDigit('', '2')).toBe('2');
    expect(appendDigit('2', '000')).toBe('2000');
    expect(appendDigit('0', '5')).toBe('5');
    expect(appendDigit('25', '⌫')).toBe('2');
    expect(appendDigit('', '⌫')).toBe('');
    expect(appendDigit('123456789', '1')).toBe('123456789');
    expect(digitsToRupiah('')).toBe(0);
    expect(digitsToRupiah('200000')).toBe(200_000);
  });
});

describe('openShiftInput / uuidv7', () => {
  it('builds an idempotent request body with a v7 id', () => {
    const now = new Date('2026-10-26T07:00:00Z');
    const body = openShiftInput(200_000, now);
    expect(body).toMatchObject({ opening_cash: 200_000, opened_at: '2026-10-26T07:00:00.000Z' });
    expect(body.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  it('is time-ordered', () => {
    expect(uuidv7(1_000) < uuidv7(2_000)).toBe(true);
  });
});
