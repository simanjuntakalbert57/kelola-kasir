import type { Shift } from '@kelola-kasir/contracts';
import { ApiError, NetworkError, type ApiClient } from '../api/client';
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

export interface OpenShiftFailure {
  message: string;
  /** `login`: session expired, go back to PIN login. `reset`: device revoked, back to pairing. */
  action: 'none' | 'login' | 'reset';
}

/** Maps an open-shift failure to an actionable Indonesian message (never raw API text). */
export function describeOpenShiftError(error: unknown): OpenShiftFailure {
  if (error instanceof NetworkError) {
    return {
      message:
        'Tidak bisa terhubung ke server. Periksa internet lalu coba lagi. Server bisa butuh sekitar 1 menit untuk bangun.',
      action: 'none',
    };
  }
  if (error instanceof ApiError) {
    if (error.code === 'DEVICE_REVOKED') {
      return {
        message: 'Perangkat ini sudah dicabut aksesnya. Pasangkan ulang dengan kode dari pemilik.',
        action: 'reset',
      };
    }
    if (error.status === 401) {
      return { message: 'Sesi habis. Masuk lagi dengan PIN Anda.', action: 'login' };
    }
    if (error.status === 403) {
      return {
        message: 'Akun ini tidak boleh membuka shift. Hubungi pemilik atau masuk dengan akun lain.',
        action: 'none',
      };
    }
    if (error.code === 'SHIFT_ALREADY_OPEN') {
      return {
        message: 'Sudah ada shift terbuka di gerai ini tetapi gagal bergabung. Coba lagi.',
        action: 'none',
      };
    }
    if (error.status === 422) {
      const onClock = error.problem?.errors?.some((e) => e.path === 'opened_at') ?? false;
      return {
        message: onClock
          ? 'Jam di HP ini tidak sesuai (terlalu cepat). Perbaiki tanggal & jam di Pengaturan HP, lalu coba lagi.'
          : 'Data shift tidak valid. Periksa modal awal lalu coba lagi.',
        action: 'none',
      };
    }
    if (error.status >= 500) {
      return {
        message: 'Server sedang bermasalah. Tunggu sebentar lalu coba lagi.',
        action: 'none',
      };
    }
  }
  return { message: 'Gagal membuka shift. Coba lagi.', action: 'none' };
}
