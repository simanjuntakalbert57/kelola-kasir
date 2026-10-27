import { describe, expect, it, vi } from 'vitest';
import { proxyRequest } from './apiProxy';

const env = { API_ORIGIN: 'https://api.example', PROXY_SHARED_SECRET: 's'.repeat(32) };

function upstream(response: Response) {
  return vi.fn<typeof fetch>().mockResolvedValue(response);
}

describe('Pages Function API proxy', () => {
  it('forwards path, query, method, body and the API headers only', async () => {
    const fetchImpl = upstream(new Response('{}', { status: 201 }));
    const request = new Request('https://kelola-kasir.pages.dev/v1/products?page=2', {
      method: 'POST',
      headers: {
        authorization: 'Bearer t',
        cookie: 'kk_refresh=r',
        'content-type': 'application/json',
        'idempotency-key': 'k1',
        'cf-connecting-ip': '203.0.113.7',
        'x-forwarded-for': '6.6.6.6',
        'x-proxy-secret': 'forged',
      },
      body: '{"name":"Jus"}',
    });

    const response = await proxyRequest(request, env, fetchImpl);

    expect(response.status).toBe(201);
    const [url, init] = fetchImpl.mock.calls[0] ?? [];
    expect(url).toBe('https://api.example/v1/products?page=2');
    expect(init?.method).toBe('POST');
    expect(new TextDecoder().decode(init?.body as ArrayBuffer)).toBe('{"name":"Jus"}');
    const headers = new Headers(init?.headers);
    expect(headers.get('authorization')).toBe('Bearer t');
    expect(headers.get('cookie')).toBe('kk_refresh=r');
    expect(headers.get('idempotency-key')).toBe('k1');
    expect(headers.get('x-forwarded-for')).toBe('203.0.113.7');
    expect(headers.get('x-client-ip')).toBe('203.0.113.7');
    expect(headers.get('x-proxy-secret')).toBe(env.PROXY_SHARED_SECRET);
    expect(headers.get('x-forwarded-host')).toBe('kelola-kasir.pages.dev');
    expect(headers.has('cf-connecting-ip')).toBe(false);
  });

  it('forwards the kasir device token and employee bearer token', async () => {
    const fetchImpl = upstream(new Response('{}'));
    await proxyRequest(
      new Request('https://kelola-kasir.pages.dev/v1/auth/pin-logout', {
        method: 'POST',
        headers: {
          Accept: 'application/json, application/problem+json',
          'X-Device-Token': 'dev_token',
          Authorization: 'Bearer emp',
        },
      }),
      env,
      fetchImpl,
    );
    const headers = new Headers(fetchImpl.mock.calls[0]?.[1]?.headers);
    expect(headers.get('x-device-token')).toBe('dev_token');
    expect(headers.get('authorization')).toBe('Bearer emp');
    expect(headers.get('accept')).toBe('application/json, application/problem+json');
  });

  it('passes Set-Cookie back unchanged', async () => {
    const fetchImpl = upstream(
      new Response('{}', {
        headers: {
          'set-cookie': 'kk_refresh=x; Path=/v1/auth; HttpOnly; Secure; SameSite=Strict',
        },
      }),
    );
    const response = await proxyRequest(
      new Request('https://kelola-kasir.pages.dev/v1/auth/refresh', { method: 'POST' }),
      env,
      fetchImpl,
    );
    expect(response.headers.get('set-cookie')).toBe(
      'kk_refresh=x; Path=/v1/auth; HttpOnly; Secure; SameSite=Strict',
    );
  });

  it('does not send the client IP headers without a shared secret', async () => {
    const fetchImpl = upstream(new Response(null, { status: 204 }));
    await proxyRequest(
      new Request('https://kelola-kasir.pages.dev/v1/healthz', {
        headers: { 'cf-connecting-ip': '203.0.113.7' },
      }),
      { API_ORIGIN: env.API_ORIGIN },
      fetchImpl,
    );
    const headers = new Headers(fetchImpl.mock.calls[0]?.[1]?.headers);
    expect(headers.has('x-client-ip')).toBe(false);
    expect(headers.has('x-proxy-secret')).toBe(false);
    expect(fetchImpl.mock.calls[0]?.[1]?.body).toBeNull();
  });

  it('answers with a problem when unconfigured or the API is unreachable', async () => {
    const request = new Request('https://kelola-kasir.pages.dev/v1/me');
    expect((await proxyRequest(request, {})).status).toBe(500);
    const failing = vi.fn<typeof fetch>().mockRejectedValue(new TypeError('network'));
    const response = await proxyRequest(request, env, failing);
    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({ code: 'UPSTREAM_UNAVAILABLE' });
  });
});
