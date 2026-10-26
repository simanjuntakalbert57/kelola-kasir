import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { inject } from 'vitest';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { createDb, type DbHandle } from '../src/db/client.js';
import { errors } from '../src/errors.js';

// Production hardening for the free-tier deployment (ADR-0011, DEAR-19).
const SECRET = 'p'.repeat(32);
let handle: DbHandle;

beforeAll(() => {
  handle = createDb(inject('databaseUrl'), { max: 2 });
});
afterAll(async () => {
  await handle.close();
});

async function makeApp(env: Record<string, string> = {}) {
  const config = loadConfig({
    NODE_ENV: 'test',
    DATABASE_URL: inject('databaseUrl'),
    LOG_LEVEL: 'silent',
    ...env,
  });
  const reportError = vi.fn().mockResolvedValue(undefined);
  const app = await buildApp({ config, db: handle.db, reportError });
  app.get('/boom/:id', async () => {
    throw new Error('unexpected');
  });
  app.get('/missing', async () => {
    throw errors.notFound('nope');
  });
  app.get('/big', async () => ({ data: 'x'.repeat(5000) }));
  await app.ready();
  return { app, reportError };
}

describe('deployment hardening', () => {
  it('reports unexpected errors with the route pattern, not domain errors', async () => {
    const { app, reportError } = await makeApp();
    expect((await app.inject({ url: '/boom/42?secret=1' })).statusCode).toBe(500);
    expect((await app.inject({ url: '/missing' })).statusCode).toBe(404);
    expect(reportError).toHaveBeenCalledTimes(1);
    expect(reportError.mock.calls[0]?.[1]).toMatchObject({ method: 'GET', route: '/boom/:id' });
    await app.close();
  });

  it('gzips larger responses when the client accepts it', async () => {
    const { app } = await makeApp();
    const res = await app.inject({ url: '/big', headers: { 'accept-encoding': 'gzip' } });
    expect(res.headers['content-encoding']).toBe('gzip');
    expect(res.rawPayload.length).toBeLessThan(1000);
    await app.close();
  });

  it('rate limits per real client IP named by the trusted Pages proxy', async () => {
    const { app } = await makeApp({ RATE_LIMIT_LOGIN_MAX: '1', PROXY_SHARED_SECRET: SECRET });
    const login = (headers: Record<string, string>) =>
      app.inject({
        method: 'POST',
        url: '/v1/auth/login',
        headers,
        payload: { email: 'nobody@example.com', password: 'wrong-password' },
      });
    const viaProxy = (ip: string) => ({ 'x-proxy-secret': SECRET, 'x-client-ip': ip });

    expect((await login(viaProxy('203.0.113.1'))).statusCode).toBe(401);
    expect((await login(viaProxy('203.0.113.2'))).statusCode).toBe(401);
    expect((await login(viaProxy('203.0.113.1'))).statusCode).toBe(429);
    // A forged header without the secret falls back to the socket address.
    expect((await login({ 'x-client-ip': '198.51.100.9' })).statusCode).toBe(401);
    expect((await login({ 'x-client-ip': '198.51.100.10' })).statusCode).toBe(429);
    await app.close();
  });
});

describe('health endpoints', () => {
  it('answers /livez without the database and /healthz with it', async () => {
    const config = loadConfig({
      NODE_ENV: 'test',
      DATABASE_URL: 'postgres://invalid',
      LOG_LEVEL: 'silent',
    });
    const broken = createDb('postgres://nobody@127.0.0.1:1/none');
    const app = await buildApp({ config, db: broken.db });
    expect((await app.inject({ url: '/livez' })).json()).toEqual({ status: 'ok' });
    expect((await app.inject({ url: '/healthz' })).statusCode).toBe(503);
    await app.close();
    await broken.close();
  });
});
