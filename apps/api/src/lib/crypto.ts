import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';

export const sha256Hex = (value: string): string =>
  createHash('sha256').update(value).digest('hex');

/** 256-bit URL-safe random token (device tokens, refresh tokens). */
export const randomToken = (): string => randomBytes(32).toString('base64url');

/** Base32 without ambiguous characters (no 0, 1, I, O): matches `^[A-HJ-NP-Z2-9]{8}$`. */
const PAIRING_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function generatePairingCode(): string {
  let code = '';
  for (let i = 0; i < 8; i += 1) code += PAIRING_ALPHABET[randomInt(PAIRING_ALPHABET.length)];
  return code;
}

export const normalizePairingCode = (input: string): string =>
  input.replace(/[\s-]/g, '').toUpperCase();

/** Deterministic PIN fingerprint, scoped per outlet, so uniqueness can be enforced in the database. */
export const pinFingerprint = (secret: string, outletId: string, pin: string): string =>
  createHmac('sha256', secret).update(`${outletId}:${pin}`).digest('hex');

export function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}
