import { describe, expect, it } from 'vitest';
import { generatePairingCode, normalizePairingCode, pinFingerprint, sha256Hex } from './crypto.js';
import { hashSecret, verifySecret } from './passwords.js';
import { endOfBusinessDay, startOfBusinessDay } from './time.js';

describe('crypto helpers', () => {
  it('generates 8-character pairing codes without ambiguous characters', () => {
    for (let i = 0; i < 200; i += 1) expect(generatePairingCode()).toMatch(/^[A-HJ-NP-Z2-9]{8}$/);
  });
  it('normalises typed pairing codes', () => {
    expect(normalizePairingCode(' ab12-cd34 ')).toBe('AB12CD34');
  });
  it('fingerprints PINs per outlet and secret', () => {
    const s = 's'.repeat(32);
    expect(pinFingerprint(s, 'o1', '123456')).toBe(pinFingerprint(s, 'o1', '123456'));
    expect(pinFingerprint(s, 'o1', '123456')).not.toBe(pinFingerprint(s, 'o2', '123456'));
    expect(pinFingerprint(s, 'o1', '123456')).not.toBe(
      pinFingerprint('t'.repeat(32), 'o1', '123456'),
    );
    expect(sha256Hex('a')).toHaveLength(64);
  });
});

describe('argon2id', () => {
  it('hashes with argon2id and verifies', async () => {
    const hash = await hashSecret('123456');
    expect(hash.startsWith('$argon2id$')).toBe(true);
    expect(await verifySecret(hash, '123456')).toBe(true);
    expect(await verifySecret(hash, '123457')).toBe(false);
    expect(await verifySecret('not-a-hash', '123456')).toBe(false);
  });
});

describe('WIB business day', () => {
  it('maps a business date to its UTC range', () => {
    expect(startOfBusinessDay('2026-10-26').toISOString()).toBe('2026-10-25T17:00:00.000Z');
    expect(endOfBusinessDay('2026-10-26').toISOString()).toBe('2026-10-26T17:00:00.000Z');
  });
});
