import { argon2idAsync } from '@noble/hashes/argon2.js';
import { describe, expect, it } from 'vitest';
import { parsePhc, verifyPin } from './pinVerify';

const b64 = (b: Uint8Array) => Buffer.from(b).toString('base64').replace(/=+$/, '');

async function makeHash(pin: string) {
  const salt = Uint8Array.from({ length: 16 }, (_, i) => i + 1);
  const hash = await argon2idAsync(pin, salt, { m: 1024, t: 2, p: 1, dkLen: 32 });
  return `$argon2id$v=19$m=1024,t=2,p=1$${b64(salt)}$${b64(hash)}`;
}

describe('verifyPin', () => {
  it('accepts the right PIN and rejects a wrong one', async () => {
    const encoded = await makeHash('123456');
    expect(await verifyPin('123456', encoded)).toBe(true);
    expect(await verifyPin('123457', encoded)).toBe(false);
  });

  it('rejects malformed hashes', async () => {
    expect(parsePhc('nope')).toBeNull();
    expect(await verifyPin('123456', '$bcrypt$x$y$z$w')).toBe(false);
  });
});
