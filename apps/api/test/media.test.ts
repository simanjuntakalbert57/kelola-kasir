import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestEnv, type TestEnv } from './helpers.js';

const storage = {
  endpoint: 'https://acct.r2.cloudflarestorage.com',
  bucket: 'media',
  accessKeyId: 'AKIDEXAMPLE',
  secretAccessKey: 'secret-example',
  region: 'auto',
  apiPublicBaseUrl: 'https://api.example',
};
const key = (purpose = 'logo', ext = 'png') => `${randomUUID()}/${purpose}/${randomUUID()}.${ext}`;

let withStorage: TestEnv;
let without: TestEnv;
beforeAll(async () => {
  withStorage = await createTestEnv({ storage });
  without = await createTestEnv();
});
afterAll(async () => {
  await withStorage.close();
  await without.close();
});

const get = (env: TestEnv, path: string) => env.app.inject({ method: 'GET', url: path });

describe('GET /v1/media/*', () => {
  it('redirects to a short-lived presigned GET without auth', async () => {
    const k = key('qris_image', 'webp');
    const res = await get(withStorage, `/v1/media/${k}`);
    expect(res.statusCode).toBe(302);
    expect(res.headers['cache-control']).toBe('private, max-age=300');
    const location = new URL(String(res.headers['location']));
    expect(location.origin).toBe(storage.endpoint);
    expect(location.pathname).toBe(`/media/${k}`);
    expect(location.searchParams.get('X-Amz-Expires')).toBe('600');
    expect(location.searchParams.get('X-Amz-SignedHeaders')).toBe('host');
    expect(location.searchParams.get('X-Amz-Signature')).toMatch(/^[0-9a-f]{64}$/);
    expect(location.href).not.toContain('secret-example');
  });

  it('answers 404 for keys this API never issues, including traversal', async () => {
    const id = randomUUID();
    for (const path of [
      `${id}/avatar/${id}.png`,
      `${id}/logo/${id}.gif`,
      `${id}/logo/${id}.png/extra`,
      `postgres/backup.sql.age`,
      `${id}/logo/../../postgres/backup.sql.age`,
      `${id}/logo/%2e%2e/${id}.png`,
      `..%2f${id}/logo/${id}.png`,
      '',
    ]) {
      const res = await get(withStorage, `/v1/media/${path}`);
      expect(res.statusCode, path).toBe(404);
    }
  });

  it('answers 503 UPLOADS_NOT_CONFIGURED when storage is not set up', async () => {
    const res = await get(without, `/v1/media/${key()}`);
    expect(res.statusCode).toBe(503);
    expect(JSON.parse(res.body)).toMatchObject({ code: 'UPLOADS_NOT_CONFIGURED' });
  });
});
