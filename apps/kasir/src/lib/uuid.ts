/**
 * Hermes (release builds) has no global `crypto`, so fall back to expo-crypto's
 * native CSPRNG. It is required lazily so Node (tests) never loads it.
 */
function secureRandom(bytes: Uint8Array): void {
  if (typeof globalThis.crypto?.getRandomValues === 'function') {
    globalThis.crypto.getRandomValues(bytes);
    return;
  }
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const crypto: { getRandomValues: (b: Uint8Array) => unknown } = require('expo-crypto');
  crypto.getRandomValues(bytes);
}

/** UUIDv7 (RFC 9562) for client-generated ids (ADR-0008). */
export function uuidv7(
  now: number = Date.now(),
  random: (bytes: Uint8Array) => void = secureRandom,
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
