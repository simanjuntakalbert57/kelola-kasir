import { afterEach, describe, expect, it, vi } from 'vitest';
import { json } from '../test/helpers';
import { uploadImage } from './upload';

afterEach(() => vi.unstubAllGlobals());

describe('uploadImage', () => {
  it('sends the SHA-256 checksum to the API and on the PUT (Object Lock buckets need it)', async () => {
    const file = new File(['hello'], 'a.png', { type: 'image/png' });
    // base64(sha256('hello'))
    const checksum = 'LPJNul+wow4m6DsqxbninhsWHlwfp0JecwQzYpOLmCQ=';
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === 'PUT') return new Response(null, { status: 200 });
      expect(String(url)).toMatch(/\/uploads$/);
      expect(JSON.parse(String(init?.body))).toMatchObject({ checksum_sha256: checksum });
      return json(
        {
          upload_url: 'https://s3.test/bucket/key',
          upload_headers: { 'Content-Type': 'image/png', 'x-amz-checksum-sha256': checksum },
          public_url: 'https://app.test/v1/media/key',
          expires_at: '2026-01-01T00:00:00Z',
        },
        201,
      );
    });
    vi.stubGlobal('fetch', fetchMock);
    await expect(uploadImage(file, 'logo')).resolves.toBe('https://app.test/v1/media/key');
    const put = fetchMock.mock.calls.find(([, init]) => init?.method === 'PUT');
    expect(put?.[1]?.headers).toMatchObject({ 'x-amz-checksum-sha256': checksum });
  });
});
