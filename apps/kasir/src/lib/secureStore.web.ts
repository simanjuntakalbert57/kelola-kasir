import type { KeyValueStore } from './storage';

/** Web preview only (screenshots, `expo start --web`): localStorage. Android uses expo-secure-store. */
export const secureStore: KeyValueStore = {
  get: (key) => Promise.resolve(globalThis.localStorage.getItem(key)),
  set: (key, value) => {
    globalThis.localStorage.setItem(key, value);
    return Promise.resolve();
  },
  remove: (key) => {
    globalThis.localStorage.removeItem(key);
    return Promise.resolve();
  },
};
