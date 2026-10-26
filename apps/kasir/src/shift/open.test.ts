import type { Shift } from '@kelola-kasir/contracts';
import { describe, expect, it, vi } from 'vitest';
import { ApiError, NetworkError } from '../api/client';
import { canOpenShift, openOrJoinShift } from './open';

const SHIFT = { id: 's1', status: 'open', opening_cash: 200000 } as Shift;

describe('openOrJoinShift', () => {
  it('opens a new shift', async () => {
    const openShift = vi.fn().mockResolvedValue(SHIFT);
    const getCurrentShift = vi.fn();
    const res = await openOrJoinShift({ openShift, getCurrentShift }, 200000);
    expect(res).toEqual({ shift: SHIFT, joined: false });
    expect(openShift.mock.calls[0]?.[0]).toMatchObject({ opening_cash: 200000 });
    expect(getCurrentShift).not.toHaveBeenCalled();
  });

  it('joins the open shift on 409 SHIFT_ALREADY_OPEN', async () => {
    const openShift = vi.fn().mockRejectedValue(new ApiError(409, 'SHIFT_ALREADY_OPEN', 'x'));
    const getCurrentShift = vi.fn().mockResolvedValue(SHIFT);
    const res = await openOrJoinShift({ openShift, getCurrentShift }, 0);
    expect(res).toEqual({ shift: SHIFT, joined: true });
  });

  it('rethrows the 409 when the open shift cannot be fetched, and other errors as-is', async () => {
    const conflict = new ApiError(409, 'SHIFT_ALREADY_OPEN', 'x');
    await expect(
      openOrJoinShift(
        {
          openShift: vi.fn().mockRejectedValue(conflict),
          getCurrentShift: vi.fn().mockResolvedValue(null),
        },
        0,
      ),
    ).rejects.toBe(conflict);
    await expect(
      openOrJoinShift(
        { openShift: vi.fn().mockRejectedValue(new NetworkError()), getCurrentShift: vi.fn() },
        0,
      ),
    ).rejects.toBeInstanceOf(NetworkError);
  });
});

describe('canOpenShift', () => {
  const base = { offline: false, busy: false, shiftChecked: true, checkFailed: false };
  it('is enabled online once the shift state is known', () => {
    expect(canOpenShift(base)).toBe(true);
    expect(canOpenShift({ ...base, shiftChecked: false, checkFailed: true })).toBe(true);
  });
  it('is disabled offline, while busy, or before the check finished', () => {
    expect(canOpenShift({ ...base, offline: true })).toBe(false);
    expect(canOpenShift({ ...base, busy: true })).toBe(false);
    expect(canOpenShift({ ...base, shiftChecked: false })).toBe(false);
  });
});
