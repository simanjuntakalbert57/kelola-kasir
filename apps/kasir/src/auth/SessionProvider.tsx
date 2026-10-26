import type { Shift } from '@kelola-kasir/contracts';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { ReactNode } from 'react';
import { ApiError, createApiClient, NetworkError, type ApiClient } from '../api/client';
import { API_BASE_URL, APP_VERSION } from '../config';
import { getJson, setJson, STORAGE_KEYS } from '../lib/storage';
import { secureStore } from '../lib/secureStore';
import { loadSuggestedOpeningCash, openShiftInput } from '../shift/prefill';
import {
  loadPairing,
  loginWithPin,
  pairDevice,
  wipeDevice,
  type CachedEmployee,
  type EmployeeSessionInfo,
  type LoginResult,
  type PairedDevice,
} from './flows';

type Boot = 'booting' | 'ready';

export interface SessionValue {
  boot: Boot;
  api: ApiClient;
  paired: PairedDevice | null;
  session: EmployeeSessionInfo | null;
  shift: Shift | null;
  /** True once the shift state of the current session is known (online or cached). */
  shiftChecked: boolean;
  pair: (code: string) => Promise<void>;
  login: (employee: CachedEmployee, pin: string) => Promise<LoginResult>;
  logout: () => Promise<void>;
  checkShift: () => Promise<void>;
  openShift: (openingCash: number) => Promise<{ joined: boolean }>;
  suggestedOpeningCash: () => Promise<number | null>;
  resetDevice: () => Promise<void>;
}

const Ctx = createContext<SessionValue | null>(null);

export function useSession(): SessionValue {
  const value = useContext(Ctx);
  if (!value) throw new Error('useSession must be used inside SessionProvider');
  return value;
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [boot, setBoot] = useState<Boot>('booting');
  const [paired, setPaired] = useState<PairedDevice | null>(null);
  const [session, setSession] = useState<EmployeeSessionInfo | null>(null);
  const [shift, setShift] = useState<Shift | null>(null);
  const [shiftChecked, setShiftChecked] = useState(false);
  const deviceToken = useRef<string | null>(null);
  const accessToken = useRef<string | null>(null);

  const api = useMemo(
    () =>
      createApiClient({
        baseUrl: API_BASE_URL,
        getDeviceToken: () => deviceToken.current,
        getAccessToken: () => accessToken.current,
      }),
    [],
  );

  useEffect(() => {
    void (async () => {
      const existing = await loadPairing(secureStore);
      if (existing) {
        deviceToken.current = existing.deviceToken;
        setPaired({ device: existing.device, outlet: existing.outlet });
      }
      setBoot('ready');
    })();
  }, []);

  const resetDevice = useCallback(async () => {
    await wipeDevice(secureStore);
    deviceToken.current = null;
    accessToken.current = null;
    setPaired(null);
    setSession(null);
    setShift(null);
    setShiftChecked(false);
  }, []);

  const storeShift = useCallback(async (next: Shift | null) => {
    setShift(next);
    if (next) await setJson(secureStore, STORAGE_KEYS.currentShift, next);
    else await secureStore.remove(STORAGE_KEYS.currentShift);
  }, []);

  const checkShift = useCallback(async () => {
    try {
      await storeShift(await api.getCurrentShift());
    } catch (error) {
      if (error instanceof NetworkError || (error instanceof ApiError && error.status >= 500)) {
        // Offline: keep working on the shift this device last saw.
        setShift(await getJson<Shift>(secureStore, STORAGE_KEYS.currentShift));
      } else if (error instanceof ApiError && error.code === 'DEVICE_REVOKED') {
        await resetDevice();
        return;
      } else {
        throw error;
      }
    }
    setShiftChecked(true);
  }, [api, resetDevice, storeShift]);

  const value = useMemo<SessionValue>(
    () => ({
      boot,
      api,
      paired,
      session,
      shift,
      shiftChecked,
      pair: async (code) => {
        const res = await pairDevice(api, secureStore, code, APP_VERSION);
        deviceToken.current = res.deviceToken;
        setPaired({ device: res.device, outlet: res.outlet });
      },
      login: async (employee, pin) => {
        const result = await loginWithPin({ api, store: secureStore }, employee, pin);
        if (result.ok) {
          accessToken.current = result.session.accessToken;
          setShiftChecked(false);
          setSession(result.session);
        } else if (result.reason === 'device_revoked') {
          await resetDevice();
        }
        return result;
      },
      logout: async () => {
        try {
          if (accessToken.current) await api.pinLogout();
        } catch {
          // Logging out locally must always work, even offline.
        }
        accessToken.current = null;
        setSession(null);
        setShiftChecked(false);
      },
      checkShift,
      openShift: async (openingCash) => {
        try {
          const opened = await api.openShift(openShiftInput(openingCash));
          await storeShift(opened);
          return { joined: false };
        } catch (error) {
          // 409 SHIFT_ALREADY_OPEN: another employee/device opened it; join that shift (TDD §2.5).
          if (error instanceof ApiError && error.code === 'SHIFT_ALREADY_OPEN') {
            await storeShift(await api.getCurrentShift());
            return { joined: true };
          }
          throw error;
        }
      },
      suggestedOpeningCash: () => loadSuggestedOpeningCash(secureStore),
      resetDevice,
    }),
    [boot, api, paired, session, shift, shiftChecked, checkShift, resetDevice, storeShift],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
