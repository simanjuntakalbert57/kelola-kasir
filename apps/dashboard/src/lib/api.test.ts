import { afterEach, describe, expect, it, vi } from 'vitest';
import { json, mockApi, problem } from '../test/helpers';
import { ApiError, api, getAccessToken, setAccessToken, setUnauthorizedHandler } from './api';

afterEach(() => {
  vi.unstubAllGlobals();
  setAccessToken(null);
  setUnauthorizedHandler(null);
});

describe('api client', () => {
  it('sends the bearer token and parses JSON', async () => {
    setAccessToken('abc');
    mockApi({ 'GET /employees': () => json({ data: [] }) });
    await expect(api('/employees')).resolves.toEqual({ data: [] });
    const init = vi.mocked(fetch).mock.calls[0]?.[1];
    expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer abc');
    expect(init?.credentials).toBe('include');
  });

  it('refreshes once on 401 and retries with the new token', async () => {
    setAccessToken('old');
    let first = true;
    mockApi({
      'GET /devices': () => {
        if (first) {
          first = false;
          return problem(401, 'UNAUTHORIZED');
        }
        return json({ data: ['ok'] });
      },
      'POST /auth/refresh': () => json({ access_token: 'new', expires_in: 900, user: {} }),
    });
    await expect(api('/devices')).resolves.toEqual({ data: ['ok'] });
    expect(getAccessToken()).toBe('new');
  });

  it('calls the unauthorized handler when refresh fails', async () => {
    const handler = vi.fn();
    setUnauthorizedHandler(handler);
    mockApi({
      'GET /devices': () => problem(401, 'UNAUTHORIZED'),
      'POST /auth/refresh': () => problem(401, 'UNAUTHORIZED'),
    });
    await expect(api('/devices')).rejects.toBeInstanceOf(ApiError);
    expect(handler).toHaveBeenCalledOnce();
    expect(getAccessToken()).toBeNull();
  });

  it('maps problem+json to ApiError with code', async () => {
    mockApi({ 'POST /employees': () => problem(409, 'PIN_NOT_UNIQUE', 'Conflict') });
    await expect(api('/employees', { method: 'POST', body: '{}' })).rejects.toMatchObject({
      status: 409,
      code: 'PIN_NOT_UNIQUE',
    });
  });
});
