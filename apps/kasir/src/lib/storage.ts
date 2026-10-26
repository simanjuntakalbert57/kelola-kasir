/** Minimal async key-value store; backed by expo-secure-store (Android Keystore) in the app. */
export interface KeyValueStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
}

export function createMemoryStore(initial: Record<string, string> = {}): KeyValueStore {
  const data = new Map(Object.entries(initial));
  return {
    get: (key) => Promise.resolve(data.get(key) ?? null),
    set: (key, value) => {
      data.set(key, value);
      return Promise.resolve();
    },
    remove: (key) => {
      data.delete(key);
      return Promise.resolve();
    },
  };
}

export const STORAGE_KEYS = {
  deviceToken: 'device_token',
  device: 'device',
  outlet: 'outlet',
  employees: 'employees_cache',
  lockouts: 'pin_lockouts',
  lastClosingCash: 'last_closing_cash',
  currentShift: 'current_shift',
} as const;

export async function getJson<T>(store: KeyValueStore, key: string): Promise<T | null> {
  const raw = await store.get(key);
  if (raw === null) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export function setJson(store: KeyValueStore, key: string, value: unknown): Promise<void> {
  return store.set(key, JSON.stringify(value));
}
