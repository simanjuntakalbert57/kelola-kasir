import * as SecureStore from 'expo-secure-store';
import type { KeyValueStore } from './storage';

/** SecureStore keys allow only [A-Za-z0-9._-]; ours already comply. */
export const secureStore: KeyValueStore = {
  get: (key) => SecureStore.getItemAsync(key),
  set: (key, value) => SecureStore.setItemAsync(key, value),
  remove: (key) => SecureStore.deleteItemAsync(key),
};
