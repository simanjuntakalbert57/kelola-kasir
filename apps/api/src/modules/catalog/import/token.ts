import { createHmac, hkdfSync } from 'node:crypto';
import { safeEqual } from '../../../lib/crypto.js';

export const IMPORT_TOKEN_TTL_SEC = 30 * 60;
const INFO = 'kelola-kasir/product-import-token';

export interface TokenSubject {
  outletId: string;
  userId: string;
  fileSha256: string;
}

export interface VerifiedToken {
  catalogSeq: number;
  expiresAt: number;
}

const key = (secret: string): Buffer =>
  Buffer.from(hkdfSync('sha256', secret, Buffer.alloc(0), INFO, 32));

const sign = (secret: string, s: TokenSubject, seq: number, expires: number): string =>
  createHmac('sha256', key(secret))
    .update(`v1|${s.outletId}|${s.userId}|${s.fileSha256}|${seq}|${expires}`)
    .digest('base64url');

/** `v1.<expires_unix>.<catalog_seq>.<sha256_file_hex>.<hmac>` (ADR-0018 §2). */
export function issueImportToken(
  secret: string,
  subject: TokenSubject,
  catalogSeq: number,
  now: Date,
): { token: string; expiresAt: Date } {
  const expires = Math.floor(now.getTime() / 1000) + IMPORT_TOKEN_TTL_SEC;
  const mac = sign(secret, subject, catalogSeq, expires);
  return {
    token: `v1.${expires}.${catalogSeq}.${subject.fileSha256}.${mac}`,
    expiresAt: new Date(expires * 1000),
  };
}

/** `null` when malformed or not signed for this file/user/outlet. Expiry is the caller's call. */
export function verifyImportToken(
  secret: string,
  subject: TokenSubject,
  token: string,
): VerifiedToken | null {
  const parts = token.split('.');
  if (parts.length !== 5 || parts[0] !== 'v1') return null;
  const [, expiresRaw = '', seqRaw = '', sha = '', mac = ''] = parts;
  if (!/^\d{1,12}$/.test(expiresRaw) || !/^\d{1,15}$/.test(seqRaw)) return null;
  if (sha !== subject.fileSha256) return null;
  const expires = Number(expiresRaw);
  const seq = Number(seqRaw);
  if (!safeEqual(mac, sign(secret, subject, seq, expires))) return null;
  return { catalogSeq: seq, expiresAt: expires };
}
