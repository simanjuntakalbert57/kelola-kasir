import { createHash, createHmac } from 'node:crypto';

/** AWS Signature V4 query-string presigning for S3-compatible storage (Cloudflare R2). */

export interface PresignInput {
  method: 'GET' | 'PUT';
  /** Full URL without query, e.g. `https://acct.r2.cloudflarestorage.com/bucket/key`. */
  url: string;
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
  now: Date;
  expiresInSec: number;
  /** Extra headers that must be sent by the uploader and are therefore signed (lower-case names). */
  signedHeaders?: Record<string, string>;
}

const sha256 = (v: string): string => createHash('sha256').update(v).digest('hex');
const hmac = (key: Buffer | string, v: string): Buffer =>
  createHmac('sha256', key).update(v).digest();

/** RFC 3986 encoding as required by SigV4 (`encodeURIComponent` plus `!'()*`). */
const encode = (v: string): string =>
  encodeURIComponent(v).replace(
    /[!'()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );

export function presignUrl(input: PresignInput): string {
  const url = new URL(input.url);
  const amzDate = input.now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const date = amzDate.slice(0, 8);
  const scope = `${date}/${input.region}/s3/aws4_request`;

  const headers: Record<string, string> = { host: url.host, ...input.signedHeaders };
  const names = Object.keys(headers).sort();
  const signedHeaders = names.join(';');

  const query: Record<string, string> = {
    'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
    'X-Amz-Credential': `${input.accessKeyId}/${scope}`,
    'X-Amz-Date': amzDate,
    'X-Amz-Expires': String(input.expiresInSec),
    'X-Amz-SignedHeaders': signedHeaders,
  };
  const canonicalQuery = Object.keys(query)
    .sort()
    .map((k) => `${encode(k)}=${encode(query[k] ?? '')}`)
    .join('&');
  const canonicalHeaders = names.map((n) => `${n}:${(headers[n] ?? '').trim()}\n`).join('');
  const canonicalPath = url.pathname
    .split('/')
    .map((segment) => encode(decodeURIComponent(segment)))
    .join('/');
  const canonicalRequest = [
    input.method,
    canonicalPath,
    canonicalQuery,
    canonicalHeaders,
    signedHeaders,
    'UNSIGNED-PAYLOAD',
  ].join('\n');
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256(canonicalRequest)].join('\n');

  const kDate = hmac(`AWS4${input.secretAccessKey}`, date);
  const kRegion = hmac(kDate, input.region);
  const kService = hmac(kRegion, 's3');
  const kSigning = hmac(kService, 'aws4_request');
  const signature = createHmac('sha256', kSigning).update(stringToSign).digest('hex');

  return `${url.origin}${canonicalPath}?${canonicalQuery}&X-Amz-Signature=${signature}`;
}
