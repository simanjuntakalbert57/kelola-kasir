import type { Shift } from '@kelola-kasir/contracts';
import { ApiError, type ApiClient } from '../api/client';
import { openShiftInput } from './prefill';

/**
 * Opens a shift, or joins the outlet's already-open one on `409 SHIFT_ALREADY_OPEN` (TDD §2.5).
 * Always needs the network: a NetworkError from the API propagates to the caller.
 */
export async function openOrJoinShift(
  api: Pick<ApiClient, 'openShift' | 'getCurrentShift'>,
  openingCash: number,
): Promise<{ shift: Shift; joined: boolean }> {
  try {
    return { shift: await api.openShift(openShiftInput(openingCash)), joined: false };
  } catch (error) {
    if (error instanceof ApiError && error.code === 'SHIFT_ALREADY_OPEN') {
      const current = await api.getCurrentShift();
      if (!current) throw error;
      return { shift: current, joined: true };
    }
    throw error;
  }
}

/** Opening a shift is online-only, so the button stays disabled for offline sessions. */
export function canOpenShift(state: {
  offline: boolean;
  busy: boolean;
  shiftChecked: boolean;
  checkFailed: boolean;
}): boolean {
  if (state.offline || state.busy) return false;
  return state.shiftChecked || state.checkFailed;
}
