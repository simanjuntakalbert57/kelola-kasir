import { describe, expect, it, vi } from 'vitest';
import type { ApiClient } from '../api/client';
import { ApiError, NetworkError } from '../api/client';
import { createMemoryStore, STORAGE_KEYS } from '../lib/storage';
import {
  getLockStatus,
  isValidPairingCode,
  loadEmployees,
  loadPairing,
  loginWithPin,
  normalizePairingCode,
  pairDevice,
  wipeDevice,
} from './flows';

const SARI = { id: 'e1', name: 'Sari', pin_hash: '$argon2id$hash' };
const T0 = 1_000_000;

function fakeApi(overrides: Partial<ApiClient> = {}): ApiClient {
  return overrides as ApiClient;
}

describe('pairing', () => {
  it('normalizes and validates the 8-char code', () => {
    expect(normalizePairingCode('ab12-cd34')).toBe('AB12CD34');
    expect(isValidPairingCode('AB12CD34')).toBe(true);
    expect(isValidPairingCode('AB12')).toBe(false);
  });

  it('stores the device token and outlet, and loadPairing restores them', async () => {
    const store = createMemoryStore();
    const pairDeviceMock = vi.fn().mockResolvedValue({
      device: { id: 'd1', code: 'K01', name: 'HP Sari', status: 'active' },
      device_token: 'tok',
      outlet: { id: 'o1', code: 'JUS1', name: 'Jus Albert', timezone: 'Asia/Jakarta' },
    });
    await pairDevice(fakeApi({ pairDevice: pairDeviceMock }), store, 'ab12-cd34', '0.1.0');
    expect(pairDeviceMock).toHaveBeenCalledWith('AB12CD34', '0.1.0');
    const restored = await loadPairing(store);
    expect(restored?.deviceToken).toBe('tok');
    expect(restored?.outlet.code).toBe('JUS1');
  });

  it('rejects a malformed code without calling the API', async () => {
    const pairDeviceMock = vi.fn();
    await expect(
      pairDevice(fakeApi({ pairDevice: pairDeviceMock }), createMemoryStore(), 'x', '0.1.0'),
    ).rejects.toMatchObject({ code: 'INVALID_CODE' });
    expect(pairDeviceMock).not.toHaveBeenCalled();
  });

  it('wipeDevice clears credentials', async () => {
    const store = createMemoryStore({ [STORAGE_KEYS.deviceToken]: 'tok' });
    await wipeDevice(store);
    expect(await store.get(STORAGE_KEYS.deviceToken)).toBeNull();
  });
});

describe('loadEmployees', () => {
  it('caches online results with PIN hashes and serves the cache offline', async () => {
    const store = createMemoryStore();
    const online = fakeApi({
      listDeviceEmployees: vi.fn().mockResolvedValue({ data: [{ id: 'e1', name: 'Sari' }] }),
      syncPull: vi.fn().mockResolvedValue({
        changes: { employees: [{ id: 'e1', name: 'Sari', is_active: true, pin_hash: 'H' }] },
      }),
    });
    const first = await loadEmployees(online, store);
    expect(first).toEqual({
      employees: [{ id: 'e1', name: 'Sari', pin_hash: 'H' }],
      fromCache: false,
    });
    const offline = fakeApi({
      listDeviceEmployees: vi.fn().mockRejectedValue(new NetworkError()),
    });
    const second = await loadEmployees(offline, store);
    expect(second.fromCache).toBe(true);
    expect(second.employees[0]?.pin_hash).toBe('H');
  });

  it('stores one SecureStore key per employee, each far below 2048 bytes', async () => {
    const store = createMemoryStore();
    const many = Array.from({ length: 60 }, (_, i) => ({
      id: `00000000-0000-0000-0000-${String(i).padStart(12, '0')}`,
      name: `Pegawai ${i}`,
    }));
    const hash = '$argon2id$v=19$m=19456,t=2,p=1$' + 'x'.repeat(90);
    const api = fakeApi({
      listDeviceEmployees: vi.fn().mockResolvedValue({ data: many }),
      syncPull: vi.fn().mockResolvedValue({
        changes: { employees: many.map((e) => ({ ...e, is_active: true, pin_hash: hash })) },
      }),
    });
    const sizes: number[] = [];
    const spy = {
      ...store,
      set: (k: string, v: string) => {
        sizes.push(v.length);
        return store.set(k, v);
      },
    };
    await loadEmployees(api, spy);
    expect(Math.max(...sizes)).toBeLessThan(2048);
    const offline = fakeApi({ listDeviceEmployees: vi.fn().mockRejectedValue(new NetworkError()) });
    const cached = await loadEmployees(offline, store);
    expect(cached.employees).toHaveLength(60);
    expect(cached.employees[3]?.pin_hash).toBe(hash);
  });

  it('treats device_revoked in /sync/pull like a DEVICE_REVOKED error', async () => {
    const api = fakeApi({
      listDeviceEmployees: vi.fn().mockResolvedValue({ data: [] }),
      syncPull: vi.fn().mockResolvedValue({ changes: {}, device_revoked: true }),
    });
    await expect(loadEmployees(api, createMemoryStore())).rejects.toMatchObject({
      code: 'DEVICE_REVOKED',
    });
  });

  it('wipeDevice also removes the per-employee cache keys', async () => {
    const store = createMemoryStore();
    const api = fakeApi({
      listDeviceEmployees: vi.fn().mockResolvedValue({ data: [{ id: 'e1', name: 'Sari' }] }),
      syncPull: vi.fn().mockResolvedValue({ changes: {} }),
    });
    await loadEmployees(api, store);
    expect(await store.get('employee.0')).not.toBeNull();
    await wipeDevice(store);
    expect(await store.get('employee.0')).toBeNull();
  });
});

describe('loginWithPin', () => {
  it('logs in online and clears failures', async () => {
    const store = createMemoryStore();
    const api = fakeApi({
      pinLogin: vi.fn().mockResolvedValue({
        access_token: 'jwt',
        expires_in: 43200,
        employee: { id: 'e1', name: 'Sari', is_active: true },
      }),
    });
    const res = await loginWithPin({ api, store, now: () => T0 }, SARI, '123456');
    expect(res).toMatchObject({ ok: true, session: { accessToken: 'jwt', offline: false } });
  });

  it('counts wrong PINs and locks for 5 minutes after the 5th', async () => {
    const store = createMemoryStore();
    const api = fakeApi({
      pinLogin: vi.fn().mockRejectedValue(new ApiError(401, 'INVALID_PIN', 'x')),
    });
    const deps = { api, store, now: () => T0 };
    const first = await loginWithPin(deps, SARI, '000000');
    expect(first).toMatchObject({ ok: false, reason: 'wrong_pin', attemptsLeft: 4 });
    for (let i = 0; i < 3; i++) await loginWithPin(deps, SARI, '000000');
    const fifth = await loginWithPin(deps, SARI, '000000');
    expect(fifth).toMatchObject({ ok: false, reason: 'locked' });
    // Locked: the API is not even called.
    const calls = (api.pinLogin as ReturnType<typeof vi.fn>).mock.calls.length;
    await loginWithPin(deps, SARI, '123456');
    expect((api.pinLogin as ReturnType<typeof vi.fn>).mock.calls.length).toBe(calls);
    expect((await getLockStatus(store, 'e1', T0)).locked).toBe(true);
    // After 5 minutes the lock expires.
    expect((await getLockStatus(store, 'e1', T0 + 5 * 60_000 + 1)).locked).toBe(false);
  });

  it('falls back to the cached hash when offline', async () => {
    const store = createMemoryStore();
    const api = fakeApi({ pinLogin: vi.fn().mockRejectedValue(new NetworkError()) });
    const verify = vi.fn().mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    const ok = await loginWithPin({ api, store, now: () => T0, verify }, SARI, '123456');
    expect(ok).toMatchObject({ ok: true, session: { offline: true, accessToken: null } });
    const bad = await loginWithPin({ api, store, now: () => T0, verify }, SARI, '654321');
    expect(bad).toMatchObject({ ok: false, reason: 'wrong_pin' });
  });

  it('needs internet when offline without a cached hash', async () => {
    const api = fakeApi({ pinLogin: vi.fn().mockRejectedValue(new NetworkError()) });
    const res = await loginWithPin(
      { api, store: createMemoryStore(), now: () => T0 },
      { id: 'e2', name: 'Budi' },
      '123456',
    );
    expect(res).toMatchObject({ ok: false, reason: 'needs_internet' });
  });

  it('maps DEVICE_REVOKED and PIN_LOCKED from the server', async () => {
    const store = createMemoryStore();
    const revoked = fakeApi({
      pinLogin: vi.fn().mockRejectedValue(new ApiError(401, 'DEVICE_REVOKED', 'x')),
    });
    expect(
      await loginWithPin({ api: revoked, store, now: () => T0 }, SARI, '123456'),
    ).toMatchObject({
      reason: 'device_revoked',
    });
    const locked = fakeApi({
      pinLogin: vi.fn().mockRejectedValue(new ApiError(423, 'PIN_LOCKED', 'x')),
    });
    expect(await loginWithPin({ api: locked, store, now: () => T0 }, SARI, '123456')).toMatchObject(
      {
        reason: 'locked',
      },
    );
  });
});
