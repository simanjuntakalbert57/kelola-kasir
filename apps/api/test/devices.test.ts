import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { auditLogs, devicePairingCodes, devices } from '../src/db/schema.js';
import { sha256Hex } from '../src/lib/crypto.js';
import {
  bearer,
  cashierSession,
  createEmployee,
  createPairedDevice,
  createTestEnv,
  json,
  loginOwner,
  pinLogin,
  seedOutlet,
  type SeededOutlet,
  type TestEnv,
} from './helpers.js';

let env: TestEnv;
let seeded: SeededOutlet;
let ownerToken: string;
beforeAll(async () => {
  env = await createTestEnv();
  seeded = await seedOutlet(env);
  ownerToken = (await loginOwner(env, seeded)).token;
});
afterAll(async () => {
  await env.close();
});

const createDevice = (name = 'Kasir 1') =>
  env.app.inject({
    method: 'POST',
    url: '/v1/devices',
    headers: bearer(ownerToken),
    payload: { name },
  });
const pair = (pairing_code: string) =>
  env.app.inject({
    method: 'POST',
    url: '/v1/devices/pair',
    payload: { pairing_code, platform: 'android' },
  });

describe('device pairing', () => {
  it('creates a device with a one-time code valid for 10 minutes, stored only as a hash', async () => {
    const res = await createDevice('Kasir Depan');
    expect(res.statusCode).toBe(201);
    const body = json<{
      device: { id: string; code: string; status: string };
      pairing_code: string;
      pairing_expires_at: string;
    }>(res);
    expect(body.pairing_code).toMatch(/^[A-HJ-NP-Z2-9]{8}$/);
    expect(body.device).toMatchObject({ status: 'pending_pairing' });
    expect(body.device.code).toMatch(/^K\d{2}$/);
    expect(new Date(body.pairing_expires_at).getTime() - env.clock.now.getTime()).toBeCloseTo(
      10 * 60 * 1000,
      -3,
    );
    const rows = await env.handle.db
      .select()
      .from(devicePairingCodes)
      .where(eq(devicePairingCodes.deviceId, body.device.id));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.codeHash).toBe(sha256Hex(body.pairing_code));
  });

  it('assigns sequential device codes per outlet', async () => {
    const other = await seedOutlet(env);
    const token = (await loginOwner(env, other)).token;
    const codes: string[] = [];
    for (let i = 0; i < 3; i += 1) {
      const res = await env.app.inject({
        method: 'POST',
        url: '/v1/devices',
        headers: bearer(token),
        payload: { name: `D${i}` },
      });
      codes.push(json<{ device: { code: string } }>(res).device.code);
    }
    expect(codes).toEqual(['K01', 'K02', 'K03']);
  });

  it('pairs once: returns the token a single time and stores only its hash', async () => {
    const created = json<{ pairing_code: string; device: { id: string } }>(await createDevice());
    const paired = await pair(created.pairing_code.toLowerCase());
    expect(paired.statusCode).toBe(200);
    const body = json<{
      device_token: string;
      device: { status: string };
      outlet: { id: string; code: string };
      last_transaction_number: string | null;
    }>(paired);
    expect(body.device.status).toBe('active');
    expect(body.outlet).toMatchObject({ id: seeded.outletId, code: seeded.code });
    expect(body.last_transaction_number).toBeNull();
    expect(body.device_token.length).toBeGreaterThanOrEqual(43);
    const [row] = await env.handle.db
      .select()
      .from(devices)
      .where(eq(devices.id, created.device.id));
    expect(row?.tokenHash).toBe(sha256Hex(body.device_token));
    expect(row?.tokenHash).not.toBe(body.device_token);

    const again = await pair(created.pairing_code);
    expect(again.statusCode).toBe(400);
    expect(json(again)).toMatchObject({ code: 'INVALID_PAIRING_CODE' });
  });

  it('lets only one of two concurrent pairings win', async () => {
    const created = json<{ pairing_code: string }>(await createDevice());
    const results = await Promise.all([pair(created.pairing_code), pair(created.pairing_code)]);
    expect(results.map((r) => r.statusCode).sort()).toEqual([200, 400]);
  });

  it('rejects unknown and expired codes', async () => {
    expect((await pair('ZZZZZZZZ')).statusCode).toBe(400);
    const created = json<{ pairing_code: string }>(await createDevice());
    env.clock.advance(10 * 60 * 1000 + 1000);
    const expired = await pair(created.pairing_code);
    expect(expired.statusCode).toBe(400);
    expect(json(expired)).toMatchObject({ code: 'INVALID_PAIRING_CODE' });
  });

  it('rate limits pairing attempts per IP', async () => {
    const limited = await createTestEnv({ rateLimit: { loginMax: 1000, pairMax: 3 } });
    try {
      const statuses: number[] = [];
      for (let i = 0; i < 5; i += 1) {
        const res = await limited.app.inject({
          method: 'POST',
          url: '/v1/devices/pair',
          payload: { pairing_code: 'AAAAAAAA' },
        });
        statuses.push(res.statusCode);
      }
      expect(statuses).toEqual([400, 400, 400, 429, 429]);
    } finally {
      await limited.close();
    }
  });

  it('lists devices of the outlet only', async () => {
    const other = await seedOutlet(env);
    const otherToken = (await loginOwner(env, other)).token;
    const res = await env.app.inject({
      method: 'GET',
      url: '/v1/devices',
      headers: bearer(otherToken),
    });
    expect(json<{ data: unknown[] }>(res).data).toHaveLength(0);
    const mine = await env.app.inject({
      method: 'GET',
      url: '/v1/devices',
      headers: bearer(ownerToken),
    });
    expect(json<{ data: unknown[] }>(mine).data.length).toBeGreaterThan(0);
  });
});

describe('device token middleware and revocation', () => {
  it('requires a valid device token on device endpoints', async () => {
    const none = await env.app.inject({ method: 'GET', url: '/v1/devices/me/employees' });
    expect(none.statusCode).toBe(401);
    const bad = await env.app.inject({
      method: 'GET',
      url: '/v1/devices/me/employees',
      headers: { 'x-device-token': 'bogus' },
    });
    expect(bad.statusCode).toBe(401);
  });

  it('lists active employees of the device outlet without PIN data', async () => {
    const o = await seedOutlet(env);
    const token = (await loginOwner(env, o)).token;
    const device = await createPairedDevice(env, token);
    const active = await createEmployee(env, token, 'Aktif');
    const inactive = await createEmployee(env, token, 'Nonaktif');
    await env.app.inject({
      method: 'PATCH',
      url: `/v1/employees/${inactive.id}`,
      headers: bearer(token),
      payload: { is_active: false },
    });
    const res = await env.app.inject({
      method: 'GET',
      url: '/v1/devices/me/employees',
      headers: { 'x-device-token': device.token },
    });
    expect(res.statusCode).toBe(200);
    expect(json(res)).toEqual({ data: [{ id: active.id, name: 'Aktif' }] });
    expect(res.body).not.toMatch(/pin/i);
  });

  it('revoke kills the device token and every employee session on it, and is audited', async () => {
    const o = await seedOutlet(env);
    const owner = await loginOwner(env, o);
    const device = await createPairedDevice(env, owner.token);
    const session = await cashierSession(env, o, owner, device);

    const before = await env.app.inject({ method: 'GET', url: '/v1/me', headers: session.headers });
    expect(before.statusCode).toBe(200);

    const revoked = await env.app.inject({
      method: 'POST',
      url: `/v1/devices/${device.id}/revoke`,
      headers: bearer(owner.token),
    });
    expect(revoked.statusCode).toBe(200);
    expect(json(revoked)).toMatchObject({ status: 'revoked' });

    const after = await env.app.inject({ method: 'GET', url: '/v1/me', headers: session.headers });
    expect(after.statusCode).toBe(401);
    expect(json(after)).toMatchObject({ code: 'DEVICE_REVOKED' });
    const login = await pinLogin(env, device.token, session.employeeId, session.pin);
    expect(login.statusCode).toBe(401);
    expect(json(login)).toMatchObject({ code: 'DEVICE_REVOKED' });

    const [log] = await env.handle.db
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.entityId, device.id), eq(auditLogs.action, 'device.revoked')));
    expect(log).toMatchObject({ actorType: 'user', outletId: o.outletId });
  });

  it('cannot revoke a device of another outlet', async () => {
    const o1 = await seedOutlet(env);
    const o2 = await seedOutlet(env);
    const t1 = (await loginOwner(env, o1)).token;
    const t2 = (await loginOwner(env, o2)).token;
    const device = await createPairedDevice(env, t1);
    const res = await env.app.inject({
      method: 'POST',
      url: `/v1/devices/${device.id}/revoke`,
      headers: bearer(t2),
    });
    expect(res.statusCode).toBe(404);
  });
});
