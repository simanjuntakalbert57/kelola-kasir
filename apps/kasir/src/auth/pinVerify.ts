import { argon2idAsync } from '@noble/hashes/argon2.js';

interface Phc {
  m: number;
  t: number;
  p: number;
  salt: Uint8Array;
  hash: Uint8Array;
}

function b64decode(input: string): Uint8Array {
  const padded = input.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4));
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

/** Parses `$argon2id$v=19$m=65536,t=3,p=4$<salt>$<hash>` (unpadded base64). */
export function parsePhc(encoded: string): Phc | null {
  const parts = encoded.split('$');
  if (parts.length !== 6 || parts[1] !== 'argon2id') return null;
  const params = Object.fromEntries(
    (parts[3] ?? '').split(',').map((kv) => kv.split('=') as [string, string]),
  );
  const m = Number(params['m']);
  const t = Number(params['t']);
  const p = Number(params['p']);
  if (![m, t, p].every(Number.isInteger)) return null;
  try {
    return { m, t, p, salt: b64decode(parts[4] ?? ''), hash: b64decode(parts[5] ?? '') };
  } catch {
    return null;
  }
}

/** Offline PIN check against the argon2id hash synced for this device (ADR-0006). */
export async function verifyPin(pin: string, encodedHash: string): Promise<boolean> {
  const phc = parsePhc(encodedHash);
  if (!phc) return false;
  const derived = await argon2idAsync(pin, phc.salt, {
    m: phc.m,
    t: phc.t,
    p: phc.p,
    dkLen: phc.hash.length,
  });
  let diff = derived.length ^ phc.hash.length;
  for (let i = 0; i < derived.length; i++) diff |= (derived[i] ?? 0) ^ (phc.hash[i] ?? 0);
  return diff === 0;
}
