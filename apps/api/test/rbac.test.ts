import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  bearer,
  cashierSession,
  createTestEnv,
  json,
  loginOwner,
  newShiftId,
  seedOutlet,
  type CashierSession,
  type TestEnv,
} from './helpers.js';

let env: TestEnv;
let ownerToken: string;
let cashier: CashierSession;
let deviceToken: string;

beforeAll(async () => {
  env = await createTestEnv();
  const seeded = await seedOutlet(env);
  ownerToken = (await loginOwner(env, seeded)).token;
  cashier = await cashierSession(env, seeded, { token: ownerToken });
  deviceToken = cashier.headers['x-device-token'] ?? '';
});
afterAll(async () => {
  await env.close();
});

const someId = randomUUID();
const ownerOnly: { method: 'GET' | 'POST' | 'PATCH'; url: string; payload?: object }[] = [
  { method: 'GET', url: '/v1/devices' },
  { method: 'POST', url: '/v1/devices', payload: { name: 'x' } },
  { method: 'POST', url: `/v1/devices/${someId}/revoke` },
  { method: 'GET', url: '/v1/employees' },
  { method: 'POST', url: '/v1/employees', payload: { name: 'x', pin: '123456' } },
  { method: 'PATCH', url: `/v1/employees/${someId}`, payload: { name: 'x' } },
  { method: 'POST', url: `/v1/employees/${someId}/reset-pin`, payload: { pin: '123456' } },
  { method: 'GET', url: '/v1/shifts' },
  { method: 'POST', url: '/v1/auth/logout' },
];

const employeeOnly: { method: 'GET' | 'POST'; url: string; payload?: object }[] = [
  { method: 'GET', url: '/v1/shifts/current' },
  {
    method: 'POST',
    url: '/v1/shifts',
    payload: { id: newShiftId(), opening_cash: 0, opened_at: new Date().toISOString() },
  },
  {
    method: 'POST',
    url: `/v1/shifts/${someId}/close`,
    payload: { actual_cash: 0, closed_at: new Date().toISOString() },
  },
  { method: 'POST', url: '/v1/auth/pin-logout' },
];

describe('RBAC: employees cannot use owner endpoints', () => {
  for (const route of ownerOnly) {
    it(`${route.method} ${route.url.replace(someId, ':id')} -> 403 for an employee token`, async () => {
      const res = await env.app.inject({ ...route, headers: cashier.headers });
      expect(res.statusCode).toBe(403);
      expect(res.headers['content-type']).toContain('application/problem+json');
      expect(json(res)).toMatchObject({ status: 403, code: 'FORBIDDEN' });
    });

    it(`${route.method} ${route.url.replace(someId, ':id')} -> 401 without credentials`, async () => {
      const res = await env.app.inject({ ...route });
      expect(res.statusCode).toBe(401);
    });
  }

  it('a device token alone is not enough for owner endpoints', async () => {
    const res = await env.app.inject({
      method: 'GET',
      url: '/v1/employees',
      headers: { 'x-device-token': deviceToken },
    });
    expect(res.statusCode).toBe(401);
  });
});

describe('RBAC: owners cannot use employee endpoints', () => {
  for (const route of employeeOnly) {
    it(`${route.method} ${route.url.replace(someId, ':id')} -> 403 for an owner token`, async () => {
      const res = await env.app.inject({
        ...route,
        headers: { ...bearer(ownerToken), 'x-device-token': deviceToken },
      });
      expect(res.statusCode).toBe(403);
      expect(json(res)).toMatchObject({ code: 'FORBIDDEN' });
    });

    it(`${route.method} ${route.url.replace(someId, ':id')} -> 401 without credentials`, async () => {
      const res = await env.app.inject({ ...route });
      expect(res.statusCode).toBe(401);
    });
  }

  it('an employee token without its device token is rejected', async () => {
    const res = await env.app.inject({
      method: 'GET',
      url: '/v1/shifts/current',
      headers: bearer(cashier.token),
    });
    expect(res.statusCode).toBe(401);
  });
});

describe('tenant isolation', () => {
  it("another outlet's owner cannot read this outlet's shift summary", async () => {
    const shiftId = newShiftId();
    const open = await env.app.inject({
      method: 'POST',
      url: '/v1/shifts',
      headers: cashier.headers,
      payload: { id: shiftId, opening_cash: 0, opened_at: env.clock.now.toISOString() },
    });
    expect(open.statusCode).toBe(201);
    const other = await seedOutlet(env);
    const otherToken = (await loginOwner(env, other)).token;
    const res = await env.app.inject({
      method: 'GET',
      url: `/v1/shifts/${shiftId}/summary`,
      headers: bearer(otherToken),
    });
    expect(res.statusCode).toBe(404);
  });
});

describe('problem+json', () => {
  it('unknown routes and malformed JSON use problem+json', async () => {
    const missing = await env.app.inject({ method: 'GET', url: '/v1/nope' });
    expect(missing.statusCode).toBe(404);
    expect(missing.headers['content-type']).toContain('application/problem+json');
    expect(json(missing)).toMatchObject({ code: 'NOT_FOUND', status: 404, title: 'Not found' });

    const bad = await env.app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      headers: { 'content-type': 'application/json' },
      payload: '{ not json',
    });
    expect(bad.statusCode).toBe(400);
    expect(json(bad)).toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('healthz reports the database', async () => {
    const res = await env.app.inject({ method: 'GET', url: '/healthz' });
    expect(res.statusCode).toBe(200);
    expect(json(res)).toEqual({ status: 'ok', db: 'up' });
  });
});
