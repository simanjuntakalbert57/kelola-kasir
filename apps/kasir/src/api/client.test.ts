import { describe, expect, it, vi } from 'vitest';
import { ApiError, createApiClient, NetworkError } from './client';

function client(fetchImpl: typeof fetch, tokens = { device: 'dev', access: 'jwt' }) {
  return createApiClient({
    baseUrl: 'http://x/v1/',
    getDeviceToken: () => tokens.device,
    getAccessToken: () => tokens.access,
    fetchImpl,
  });
}

const jsonRes = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

describe('api client', () => {
  it('sends device and employee credentials per security scheme', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonRes(200, { data: [] }));
    await client(fetchMock as unknown as typeof fetch).listDeviceEmployees();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://x/v1/devices/me/employees');
    expect(init.headers).toMatchObject({ 'X-Device-Token': 'dev' });
    expect(init.headers).not.toHaveProperty('Authorization');
  });

  it('pairDevice sends no credentials', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonRes(200, {}));
    await client(fetchMock as unknown as typeof fetch).pairDevice('AB12CD34', '0.1.0');
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.headers).not.toHaveProperty('X-Device-Token');
    expect(JSON.parse(init.body as string)).toEqual({
      pairing_code: 'AB12CD34',
      app_version: '0.1.0',
      platform: 'android',
    });
  });

  it('maps problem+json to ApiError and failures to NetworkError', async () => {
    const problem = {
      type: 'x',
      title: 'Locked',
      status: 409,
      code: 'SHIFT_ALREADY_OPEN',
      detail: 'sudah',
    };
    const api = client(vi.fn().mockResolvedValue(jsonRes(409, problem)) as unknown as typeof fetch);
    await expect(
      api.openShift({ id: 'i', opening_cash: 0, opened_at: 'now' }),
    ).rejects.toMatchObject({
      code: 'SHIFT_ALREADY_OPEN',
      status: 409,
    });
    await expect(
      api.openShift({ id: 'i', opening_cash: 0, opened_at: 'now' }),
    ).rejects.toBeInstanceOf(ApiError);
    const down = client(
      vi.fn().mockRejectedValue(new TypeError('fail')) as unknown as typeof fetch,
    );
    await expect(down.getCurrentShift()).rejects.toBeInstanceOf(NetworkError);
  });

  it('getCurrentShift returns null on 204', async () => {
    const api = client(
      vi.fn().mockResolvedValue(new Response(null, { status: 204 })) as unknown as typeof fetch,
    );
    expect(await api.getCurrentShift()).toBeNull();
  });
});
