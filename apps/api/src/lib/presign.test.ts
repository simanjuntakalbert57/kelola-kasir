import { describe, expect, it } from 'vitest';
import { presignUrl } from './presign.js';

describe('presignUrl', () => {
  it('reproduces the AWS documentation example for a presigned GET', () => {
    const url = presignUrl({
      method: 'GET',
      url: 'https://examplebucket.s3.amazonaws.com/test.txt',
      accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
      secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
      region: 'us-east-1',
      now: new Date('2013-05-24T00:00:00Z'),
      expiresInSec: 86_400,
    });
    expect(url).toContain(
      'X-Amz-Signature=aeeed9bbccd4d02ee5c0109b86d86835f995330da4c265957d157751f604d404',
    );
    expect(url).toContain(
      'X-Amz-Credential=AKIAIOSFODNN7EXAMPLE%2F20130524%2Fus-east-1%2Fs3%2Faws4_request',
    );
  });

  it('signs extra headers such as content-type', () => {
    const base = {
      method: 'PUT' as const,
      url: 'https://acct.r2.cloudflarestorage.com/bucket/o/p/file.png',
      accessKeyId: 'key',
      secretAccessKey: 'secret',
      region: 'auto',
      now: new Date('2026-10-26T01:00:00Z'),
      expiresInSec: 600,
    };
    const plain = presignUrl(base);
    const typed = presignUrl({ ...base, signedHeaders: { 'content-type': 'image/png' } });
    expect(typed).toContain('X-Amz-SignedHeaders=content-type%3Bhost');
    expect(plain).toContain('X-Amz-SignedHeaders=host');
    expect(typed).not.toEqual(plain);
    expect(presignUrl(base)).toEqual(plain); // deterministic
  });
});
