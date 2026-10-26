import type { ApiClient } from '../api/client';
import { ApiError, NetworkError } from '../api/client';
import { PIN_LENGTH } from '../config';
import { getJson, setJson, STORAGE_KEYS, type KeyValueStore } from '../lib/storage';
import {
  attemptsLeft,
  isLocked,
  recordFailure,
  recordSuccess,
  remainingLockMs,
  type LockoutState,
} from './lockout';
import { verifyPin } from './pinVerify';

export interface PairedDevice {
  device: { id: string; code: string; name: string };
  outlet: { id: string; code: string; name: string; timezone: string };
}

export interface CachedEmployee {
  id: string;
  name: string;
  /** argon2id PHC string, only when the outlet enabled offline login (ADR-0006). */
  pin_hash?: string | null;
}

export interface EmployeeSessionInfo {
  employeeId: string;
  employeeName: string;
  /** `null` for an offline session: no server token, API calls wait for connectivity. */
  accessToken: string | null;
  offline: boolean;
}

export type LoginResult =
  | { ok: true; session: EmployeeSessionInfo }
  | {
      ok: false;
      reason: 'wrong_pin' | 'locked' | 'device_revoked' | 'needs_internet' | 'error';
      attemptsLeft?: number;
      lockedForMs?: number;
      message: string;
    };

export function normalizePairingCode(input: string): string {
  return input.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
}

export function isValidPairingCode(code: string): boolean {
  return /^[A-Z0-9]{8}$/.test(code);
}

/** Exchanges the pairing code and keeps the device token in secure storage (shown only once). */
export async function pairDevice(
  api: ApiClient,
  store: KeyValueStore,
  rawCode: string,
  appVersion: string,
): Promise<{ deviceToken: string } & PairedDevice> {
  const code = normalizePairingCode(rawCode);
  if (!isValidPairingCode(code))
    throw new ApiError(400, 'INVALID_CODE', 'Kode pairing 8 karakter.');
  const res = await api.pairDevice(code, appVersion);
  const paired: PairedDevice = {
    device: { id: res.device.id, code: res.device.code, name: res.device.name },
    outlet: res.outlet,
  };
  await store.set(STORAGE_KEYS.deviceToken, res.device_token);
  await setJson(store, STORAGE_KEYS.device, paired);
  return { deviceToken: res.device_token, ...paired };
}

export async function loadPairing(
  store: KeyValueStore,
): Promise<({ deviceToken: string } & PairedDevice) | null> {
  const deviceToken = await store.get(STORAGE_KEYS.deviceToken);
  const paired = await getJson<PairedDevice>(store, STORAGE_KEYS.device);
  return deviceToken && paired ? { deviceToken, ...paired } : null;
}

/** Revoked/unpaired device: wipe every local credential and cache. */
export async function wipeDevice(store: KeyValueStore): Promise<void> {
  for (const key of Object.values(STORAGE_KEYS)) await store.remove(key);
}

/**
 * Employee list for the PIN screen. Online: fetch and refresh the cache (plus PIN hashes via
 * `/sync/pull` when the outlet enabled offline login). Offline: serve the cache.
 */
export async function loadEmployees(
  api: ApiClient,
  store: KeyValueStore,
): Promise<{ employees: CachedEmployee[]; fromCache: boolean }> {
  try {
    const { data } = await api.listDeviceEmployees();
    const previous = (await getJson<CachedEmployee[]>(store, STORAGE_KEYS.employees)) ?? [];
    let hashes = new Map(previous.map((e) => [e.id, e.pin_hash ?? null]));
    try {
      const pull = await api.syncPull();
      const fresh = pull.changes.employees ?? [];
      if (fresh.length > 0) hashes = new Map(fresh.map((e) => [e.id, e.pin_hash ?? null]));
    } catch (error) {
      if (error instanceof ApiError && error.code === 'DEVICE_REVOKED') throw error;
      // Hash refresh is best-effort; keep previous hashes.
    }
    const employees = data.map((e) => ({
      id: e.id,
      name: e.name,
      pin_hash: hashes.get(e.id) ?? null,
    }));
    await setJson(store, STORAGE_KEYS.employees, employees);
    return { employees, fromCache: false };
  } catch (error) {
    if (error instanceof NetworkError) {
      const cached = (await getJson<CachedEmployee[]>(store, STORAGE_KEYS.employees)) ?? [];
      return { employees: cached, fromCache: true };
    }
    throw error;
  }
}

async function loadLockouts(store: KeyValueStore): Promise<LockoutState> {
  return (await getJson<LockoutState>(store, STORAGE_KEYS.lockouts)) ?? {};
}

export async function getLockStatus(store: KeyValueStore, employeeId: string, now: number) {
  const state = await loadLockouts(store);
  return {
    locked: isLocked(state, employeeId, now),
    remainingMs: remainingLockMs(state, employeeId, now),
    attemptsLeft: attemptsLeft(state, employeeId),
  };
}

export interface LoginDeps {
  api: ApiClient;
  store: KeyValueStore;
  now?: () => number;
  /** Injected for tests; defaults to the argon2id verifier. */
  verify?: (pin: string, hash: string) => Promise<boolean>;
}

/** PIN login: server first; when the network is down fall back to the cached hash. */
export async function loginWithPin(
  deps: LoginDeps,
  employee: CachedEmployee,
  pin: string,
): Promise<LoginResult> {
  const now = deps.now?.() ?? Date.now();
  const verify = deps.verify ?? verifyPin;
  if (pin.length !== PIN_LENGTH) {
    return { ok: false, reason: 'error', message: `PIN ${PIN_LENGTH} digit.` };
  }
  let lockouts = await loadLockouts(deps.store);
  if (isLocked(lockouts, employee.id, now)) {
    return lockedResult(remainingLockMs(lockouts, employee.id, now));
  }

  const fail = async (): Promise<LoginResult> => {
    lockouts = recordFailure(lockouts, employee.id, now);
    await setJson(deps.store, STORAGE_KEYS.lockouts, lockouts);
    if (isLocked(lockouts, employee.id, now)) {
      return lockedResult(remainingLockMs(lockouts, employee.id, now));
    }
    const left = attemptsLeft(lockouts, employee.id);
    return {
      ok: false,
      reason: 'wrong_pin',
      attemptsLeft: left,
      message: `PIN salah. Sisa percobaan: ${left}`,
    };
  };
  const succeed = async (session: EmployeeSessionInfo): Promise<LoginResult> => {
    await setJson(deps.store, STORAGE_KEYS.lockouts, recordSuccess(lockouts, employee.id));
    return { ok: true, session };
  };

  try {
    const res = await deps.api.pinLogin(employee.id, pin);
    return await succeed({
      employeeId: res.employee.id,
      employeeName: res.employee.name,
      accessToken: res.access_token,
      offline: false,
    });
  } catch (error) {
    if (error instanceof ApiError) {
      if (error.code === 'INVALID_PIN') return fail();
      if (error.code === 'PIN_LOCKED' || error.status === 423) {
        lockouts = { ...lockouts, [employee.id]: { failures: 5, lockedUntil: now + 5 * 60_000 } };
        await setJson(deps.store, STORAGE_KEYS.lockouts, lockouts);
        return lockedResult(5 * 60_000);
      }
      if (error.code === 'DEVICE_REVOKED') {
        return {
          ok: false,
          reason: 'device_revoked',
          message: 'Perangkat ini dicabut. Hubungi owner.',
        };
      }
      return { ok: false, reason: 'error', message: error.message };
    }
    if (!(error instanceof NetworkError)) throw error;
  }

  // Offline: verify against the cached hash.
  if (!employee.pin_hash) {
    return {
      ok: false,
      reason: 'needs_internet',
      message: 'Tidak ada koneksi. Login pertama kali butuh internet.',
    };
  }
  if (!(await verify(pin, employee.pin_hash))) return fail();
  return succeed({
    employeeId: employee.id,
    employeeName: employee.name,
    accessToken: null,
    offline: true,
  });
}

function lockedResult(ms: number): LoginResult {
  const minutes = Math.max(1, Math.ceil(ms / 60_000));
  return {
    ok: false,
    reason: 'locked',
    lockedForMs: ms,
    attemptsLeft: 0,
    message: `PIN terkunci. Coba lagi dalam ${minutes} menit.`,
  };
}
