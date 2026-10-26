import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { auditLogs, employees } from '../src/db/schema.js';
import {
  bearer,
  cashierSession,
  createEmployee,
  createPairedDevice,
  createTestEnv,
  json,
  loginOwner,
  nextPin,
  pinLogin,
  seedOutlet,
  type SeededOutlet,
  type TestEnv,
} from './helpers.js';

let env: TestEnv;
beforeAll(async () => {
  env = await createTestEnv();
});
afterAll(async () => {
  await env.close();
});

async function setup() {
  const seeded: SeededOutlet = await seedOutlet(env);
  const owner = await loginOwner(env, seeded);
  const device = await createPairedDevice(env, owner.token);
  return { seeded, owner, device };
}

describe('employee CRUD (owner)', () => {
  it('creates, lists, filters, renames and deactivates; the PIN is never returned or stored in clear', async () => {
    const { seeded, owner } = await setup();
    const created = await env.app.inject({
      method: 'POST',
      url: '/v1/employees',
      headers: bearer(owner.token),
      payload: { name: '  Budi  ', pin: '123456' },
    });
    expect(created.statusCode).toBe(201);
    const emp = json<{ id: string; name: string; is_active: boolean }>(created);
    expect(emp).toMatchObject({ name: 'Budi', is_active: true });
    expect(created.body).not.toContain('123456');

    const [row] = await env.handle.db.select().from(employees).where(eq(employees.id, emp.id));
    expect(row?.pinHash).toMatch(/^\$argon2id\$/);
    expect(row?.outletId).toBe(seeded.outletId);

    const renamed = await env.app.inject({
      method: 'PATCH',
      url: `/v1/employees/${emp.id}`,
      headers: bearer(owner.token),
      payload: { name: 'Budi S' },
    });
    expect(json(renamed)).toMatchObject({ name: 'Budi S', is_active: true });

    await env.app.inject({
      method: 'PATCH',
      url: `/v1/employees/${emp.id}`,
      headers: bearer(owner.token),
      payload: { is_active: false },
    });
    const active = await env.app.inject({
      method: 'GET',
      url: '/v1/employees?is_active=true',
      headers: bearer(owner.token),
    });
    expect(json<{ data: unknown[] }>(active).data).toHaveLength(0);
    const inactive = await env.app.inject({
      method: 'GET',
      url: '/v1/employees?is_active=false',
      headers: bearer(owner.token),
    });
    expect(json<{ data: unknown[] }>(inactive).data).toHaveLength(1);
  });

  it('validates input: PIN must be exactly 6 digits, name required, patch needs a field', async () => {
    const { owner } = await setup();
    for (const payload of [
      { name: 'X', pin: '12345' },
      { name: 'X', pin: '12345a' },
      { pin: '123456' },
      { name: '', pin: '123456' },
    ]) {
      const res = await env.app.inject({
        method: 'POST',
        url: '/v1/employees',
        headers: bearer(owner.token),
        payload,
      });
      expect(res.statusCode).toBe(400);
      expect(json(res)).toMatchObject({ code: 'VALIDATION_ERROR' });
    }
    const emp = await createEmployee(env, owner.token);
    const empty = await env.app.inject({
      method: 'PATCH',
      url: `/v1/employees/${emp.id}`,
      headers: bearer(owner.token),
      payload: {},
    });
    expect(empty.statusCode).toBe(400);
  });

  it('keeps PINs unique per outlet (PIN_NOT_UNIQUE) but allows the same PIN in another outlet', async () => {
    const a = await setup();
    const b = await setup();
    const first = await env.app.inject({
      method: 'POST',
      url: '/v1/employees',
      headers: bearer(a.owner.token),
      payload: { name: 'A', pin: '654321' },
    });
    expect(first.statusCode).toBe(201);
    const dup = await env.app.inject({
      method: 'POST',
      url: '/v1/employees',
      headers: bearer(a.owner.token),
      payload: { name: 'B', pin: '654321' },
    });
    expect(dup.statusCode).toBe(409);
    expect(json(dup)).toMatchObject({ code: 'PIN_NOT_UNIQUE' });
    const other = await env.app.inject({
      method: 'POST',
      url: '/v1/employees',
      headers: bearer(b.owner.token),
      payload: { name: 'C', pin: '654321' },
    });
    expect(other.statusCode).toBe(201);
  });

  it('reset-pin enforces uniqueness, is audited without the PIN, and ends the sessions', async () => {
    const { seeded, owner, device } = await setup();
    const session = await cashierSession(env, seeded, owner, device, 'Rina');
    const other = await createEmployee(env, owner.token, 'Lain');

    const clash = await env.app.inject({
      method: 'POST',
      url: `/v1/employees/${session.employeeId}/reset-pin`,
      headers: bearer(owner.token),
      payload: { pin: other.pin },
    });
    expect(clash.statusCode).toBe(409);
    expect(json(clash)).toMatchObject({ code: 'PIN_NOT_UNIQUE' });

    const newPin = nextPin();
    const reset = await env.app.inject({
      method: 'POST',
      url: `/v1/employees/${session.employeeId}/reset-pin`,
      headers: bearer(owner.token),
      payload: { pin: newPin },
    });
    expect(reset.statusCode).toBe(204);

    expect(
      (await env.app.inject({ method: 'GET', url: '/v1/me', headers: session.headers })).statusCode,
    ).toBe(401);
    expect((await pinLogin(env, device.token, session.employeeId, session.pin)).statusCode).toBe(
      401,
    );
    expect((await pinLogin(env, device.token, session.employeeId, newPin)).statusCode).toBe(200);

    const [log] = await env.handle.db
      .select()
      .from(auditLogs)
      .where(
        and(eq(auditLogs.entityId, session.employeeId), eq(auditLogs.action, 'employee.pin_reset')),
      );
    expect(log).toBeTruthy();
    expect(JSON.stringify(log)).not.toContain(newPin);
  });

  it('cannot touch employees of another outlet', async () => {
    const a = await setup();
    const b = await setup();
    const emp = await createEmployee(env, a.owner.token);
    const patch = await env.app.inject({
      method: 'PATCH',
      url: `/v1/employees/${emp.id}`,
      headers: bearer(b.owner.token),
      payload: { name: 'x' },
    });
    expect(patch.statusCode).toBe(404);
    const reset = await env.app.inject({
      method: 'POST',
      url: `/v1/employees/${emp.id}/reset-pin`,
      headers: bearer(b.owner.token),
      payload: { pin: nextPin() },
    });
    expect(reset.statusCode).toBe(404);
  });
});

describe('PIN login', () => {
  it('logs in on a paired device and returns a 12 hour employee session', async () => {
    const { owner, device } = await setup();
    const emp = await createEmployee(env, owner.token);
    const res = await pinLogin(env, device.token, emp.id, emp.pin);
    expect(res.statusCode).toBe(200);
    const body = json<{
      access_token: string;
      expires_in: number;
      employee: { id: string; name: string };
    }>(res);
    expect(body.expires_in).toBe(43200);
    expect(body.employee).toMatchObject({ id: emp.id, name: 'Siti' });
    const me = await env.app.inject({
      method: 'GET',
      url: '/v1/me',
      headers: { ...bearer(body.access_token), 'x-device-token': device.token },
    });
    expect(json(me)).toMatchObject({ type: 'employee', role: 'cashier', device_id: device.id });
  });

  it('requires a device token', async () => {
    const { owner } = await setup();
    const emp = await createEmployee(env, owner.token);
    const res = await env.app.inject({
      method: 'POST',
      url: '/v1/auth/pin-login',
      payload: { employee_id: emp.id, pin: emp.pin },
    });
    expect(res.statusCode).toBe(401);
  });

  it('rejects a wrong PIN and employees of another outlet or inactive ones with INVALID_PIN', async () => {
    const a = await setup();
    const b = await setup();
    const emp = await createEmployee(env, a.owner.token);
    const wrong = await pinLogin(env, a.device.token, emp.id, '000000');
    expect(wrong.statusCode).toBe(401);
    expect(json(wrong)).toMatchObject({ code: 'INVALID_PIN' });
    const crossOutlet = await pinLogin(env, b.device.token, emp.id, emp.pin);
    expect(json(crossOutlet)).toMatchObject({ code: 'INVALID_PIN' });
    await env.app.inject({
      method: 'PATCH',
      url: `/v1/employees/${emp.id}`,
      headers: bearer(a.owner.token),
      payload: { is_active: false },
    });
    const inactive = await pinLogin(env, a.device.token, emp.id, emp.pin);
    expect(json(inactive)).toMatchObject({ code: 'INVALID_PIN' });
  });

  it('locks the employee on that device after 5 wrong PINs for 5 minutes', async () => {
    const { owner, device } = await setup();
    const emp = await createEmployee(env, owner.token);
    for (let i = 0; i < 4; i += 1) {
      expect((await pinLogin(env, device.token, emp.id, '000000')).statusCode).toBe(401);
    }
    const fifth = await pinLogin(env, device.token, emp.id, '000000');
    expect(fifth.statusCode).toBe(423);
    expect(json(fifth)).toMatchObject({ code: 'PIN_LOCKED' });
    expect(fifth.headers['retry-after']).toBe('300');

    // Even the right PIN is refused while locked.
    const locked = await pinLogin(env, device.token, emp.id, emp.pin);
    expect(locked.statusCode).toBe(423);

    // Locking is per device: the same employee can still log in on another paired device.
    const otherDevice = await createPairedDevice(env, owner.token, 'Kasir 2');
    expect((await pinLogin(env, otherDevice.token, emp.id, emp.pin)).statusCode).toBe(200);

    env.clock.advance(5 * 60 * 1000 + 1000);
    expect((await pinLogin(env, device.token, emp.id, emp.pin)).statusCode).toBe(200);
  });

  it('a successful login resets the failure counter', async () => {
    const { owner, device } = await setup();
    const emp = await createEmployee(env, owner.token);
    for (let i = 0; i < 4; i += 1) await pinLogin(env, device.token, emp.id, '000000');
    expect((await pinLogin(env, device.token, emp.id, emp.pin)).statusCode).toBe(200);
    for (let i = 0; i < 4; i += 1) {
      expect((await pinLogin(env, device.token, emp.id, '000000')).statusCode).toBe(401);
    }
  });

  it('counts parallel guesses so they cannot outrun the lockout', async () => {
    const { owner, device } = await setup();
    const emp = await createEmployee(env, owner.token);
    const guesses = await Promise.all(
      Array.from({ length: 12 }, () => pinLogin(env, device.token, emp.id, '000000')),
    );
    const codes = guesses.map((r) => r.statusCode);
    expect(codes.filter((c) => c === 401).length).toBeLessThanOrEqual(4);
    expect(codes.filter((c) => c === 423).length).toBeGreaterThanOrEqual(8);
  });

  it('pin-logout ends the session', async () => {
    const { seeded, owner, device } = await setup();
    const session = await cashierSession(env, seeded, owner, device);
    const out = await env.app.inject({
      method: 'POST',
      url: '/v1/auth/pin-logout',
      headers: session.headers,
    });
    expect(out.statusCode).toBe(204);
    const me = await env.app.inject({ method: 'GET', url: '/v1/me', headers: session.headers });
    expect(me.statusCode).toBe(401);
  });

  it('a deactivated employee loses the session immediately', async () => {
    const { seeded, owner, device } = await setup();
    const session = await cashierSession(env, seeded, owner, device);
    await env.app.inject({
      method: 'PATCH',
      url: `/v1/employees/${session.employeeId}`,
      headers: bearer(owner.token),
      payload: { is_active: false },
    });
    const me = await env.app.inject({ method: 'GET', url: '/v1/me', headers: session.headers });
    expect(me.statusCode).toBe(401);
  });

  it('a session token is bound to its device', async () => {
    const { seeded, owner, device } = await setup();
    const session = await cashierSession(env, seeded, owner, device);
    const other = await createPairedDevice(env, owner.token, 'Kasir 2');
    const res = await env.app.inject({
      method: 'GET',
      url: '/v1/me',
      headers: { authorization: `Bearer ${session.token}`, 'x-device-token': other.token },
    });
    expect(res.statusCode).toBe(401);
  });

  it('expires after 12 hours', async () => {
    const { seeded, owner, device } = await setup();
    const session = await cashierSession(env, seeded, owner, device);
    env.clock.advance(12 * 60 * 60 * 1000 + 1000);
    const me = await env.app.inject({ method: 'GET', url: '/v1/me', headers: session.headers });
    expect(me.statusCode).toBe(401);
  });
});
