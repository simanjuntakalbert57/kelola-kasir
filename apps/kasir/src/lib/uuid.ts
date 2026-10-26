/**
 * Hermes has no global `crypto.getRandomValues`, so use it only when present and otherwise fall
 * back to expo-crypto (native CSPRNG). Never Math.random: ids must be unguessable and collision-free.
 */
export function fillRandom(
  bytes: Uint8Array,
  native: (b: Uint8Array) => unknown = loadNativeRandom,
): void {
  const g = (globalThis as { crypto?: { getRandomValues?: (b: Uint8Array) => unknown } }).crypto;
  if (g && typeof g.getRandomValues === 'function') g.getRandomValues(bytes);
  else native(bytes);
}

function loadNativeRandom(bytes: Uint8Array): void {
  // Lazy: expo-crypto pulls in the native runtime, which plain Node (tests) does not have.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  (require('expo-crypto') as { getRandomValues: (b: Uint8Array) => unknown }).getRandomValues(
    bytes,
  );
}

/** UUIDv7 (RFC 9562) for client-generated ids (ADR-0008). */
export function uuidv7(
  now: number = Date.now(),
  random: (bytes: Uint8Array) => void = fillRandom,
): string {
  const bytes = new Uint8Array(16);
  random(bytes);
  let ts = now;
  for (let i = 5; i >= 0; i--) {
    bytes[i] = ts % 256;
    ts = Math.floor(ts / 256);
  }
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x70;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
