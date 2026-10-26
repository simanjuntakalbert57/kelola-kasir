import { randomUUID } from 'node:crypto';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { inject } from 'vitest';
import { v7 as uuidv7 } from 'uuid';
import { buildApp } from '../src/app.js';
import { loadConfig, type Config } from '../src/config.js';
import { createDb, type DbHandle } from '../src/db/client.js';
import { outletSettings, outlets } from '../src/db/schema.js';
import { TokenService } from '../src/lib/jwt.js';
import { OwnerAuthService } from '../src/modules/auth/owner-service.js';

export const OWNER_PASSWORD = 'correct-horse-battery';

export interface TestEnv {
  app: FastifyInstance;
  handle: DbHandle;
  config: Config;
  clock: { now: Date; advance(ms: number): void };
  close(): Promise<void>;
}

export async function createTestEnv(overrides: Partial<Config> = {}): Promise<TestEnv> {
  const databaseUrl = inject('databaseUrl');
  const base = loadConfig({
    NODE_ENV: 'test',
    DATABASE_URL: databaseUrl,
    LOG_LEVEL: process.env['TEST_LOG_LEVEL'] ?? 'silent',
    RATE_LIMIT_LOGIN_MAX: '1000',
    RATE_LIMIT_PAIR_MAX: '1000',
  });
  const config: Config = { ...base, ...overrides };
  const handle = createDb(databaseUrl);
  const clock = {
    now: new Date(),
    advance(ms: number) {
      this.now = new Date(this.now.getTime() + ms);
    },
  };
  const app = await buildApp({ config, db: handle.db, now: () => new Date(clock.now) });
  await app.ready();
  return {
    app,
    handle,
    config,
    clock,
    close: async () => {
      await app.close();
      await handle.close();
    },
  };
}

export interface SeededOutlet {
  outletId: string;
  code: string;
  ownerEmail: string;
}

/** Every test seeds its own outlet and owner: tests stay isolated without truncating tables. */
export async function seedOutlet(env: TestEnv): Promise<SeededOutlet> {
  const code = `T${randomUUID().slice(0, 5).toUpperCase()}`;
  const [outlet] = await env.handle.db
    .insert(outlets)
    .values({ code, name: `Outlet ${code}` })
    .returning();
  if (!outlet) throw new Error('outlet seed failed');
  await env.handle.db
    .insert(outletSettings)
    .values({ outletId: outlet.id, displayName: outlet.name });
  const ownerEmail = `owner-${code.toLowerCase()}@example.test`;
  const service = new OwnerAuthService({
    config: env.config,
    db: env.handle.db,
    tokens: new TokenService(env.config.jwtPrivateKeyPem),
    now: () => new Date(),
  });
  await service.createOwner({
    email: ownerEmail,
    password: OWNER_PASSWORD,
    name: 'Test Owner',
    outletId: outlet.id,
  });
  return { outletId: outlet.id, code, ownerEmail };
}

export function json<T = Record<string, unknown>>(res: LightMyRequestResponse): T {
  return res.json() as T;
}

export async function loginOwner(env: TestEnv, seeded: SeededOutlet) {
  const res = await env.app.inject({
    method: 'POST',
    url: '/v1/auth/login',
    payload: { email: seeded.ownerEmail, password: OWNER_PASSWORD },
  });
  if (res.statusCode !== 200) throw new Error(`owner login failed: ${res.statusCode} ${res.body}`);
  const body = json<{ access_token: string }>(res);
  return {
    token: body.access_token,
    cookie: res.cookies.find((c) => c.name === 'kk_refresh')?.value,
  };
}

export const bearer = (token: string) => ({ authorization: `Bearer ${token}` });

let pinCounter = 100_000;
/** Distinct 6-digit PINs so tests never collide on PIN uniqueness within an outlet. */
export const nextPin = (): string => String(pinCounter++);

export async function createEmployee(
  env: TestEnv,
  ownerToken: string,
  name = 'Siti',
  pin = nextPin(),
) {
  const res = await env.app.inject({
    method: 'POST',
    url: '/v1/employees',
    headers: bearer(ownerToken),
    payload: { name, pin },
  });
  if (res.statusCode !== 201)
    throw new Error(`create employee failed: ${res.statusCode} ${res.body}`);
  return { ...json<{ id: string; name: string }>(res), pin };
}

export async function createPairedDevice(env: TestEnv, ownerToken: string, name = 'Kasir Depan') {
  const created = await env.app.inject({
    method: 'POST',
    url: '/v1/devices',
    headers: bearer(ownerToken),
    payload: { name },
  });
  const { device, pairing_code } = json<{
    device: { id: string; code: string };
    pairing_code: string;
  }>(created);
  const paired = await env.app.inject({
    method: 'POST',
    url: '/v1/devices/pair',
    payload: { pairing_code, app_version: '1.0.0', platform: 'android' },
  });
  if (paired.statusCode !== 200)
    throw new Error(`pair failed: ${paired.statusCode} ${paired.body}`);
  return {
    id: device.id,
    code: device.code,
    token: json<{ device_token: string }>(paired).device_token,
  };
}

export async function pinLogin(env: TestEnv, deviceToken: string, employeeId: string, pin: string) {
  const res = await env.app.inject({
    method: 'POST',
    url: '/v1/auth/pin-login',
    headers: { 'x-device-token': deviceToken },
    payload: { employee_id: employeeId, pin },
  });
  return res;
}

export interface CashierSession {
  employeeId: string;
  deviceId: string;
  headers: Record<string, string>;
  token: string;
  pin: string;
}

/** Owner creates an employee, pairs a device, and the employee logs in with the PIN. */
export async function cashierSession(
  env: TestEnv,
  seeded: SeededOutlet,
  owner?: { token: string },
  device?: { id: string; token: string },
  name = 'Siti',
): Promise<CashierSession> {
  const ownerToken = owner?.token ?? (await loginOwner(env, seeded)).token;
  const employee = await createEmployee(env, ownerToken, name);
  const dev = device ?? (await createPairedDevice(env, ownerToken));
  const res = await pinLogin(env, dev.token, employee.id, employee.pin);
  if (res.statusCode !== 200) throw new Error(`pin login failed: ${res.statusCode} ${res.body}`);
  const token = json<{ access_token: string }>(res).access_token;
  return {
    employeeId: employee.id,
    deviceId: dev.id,
    token,
    pin: employee.pin,
    headers: { authorization: `Bearer ${token}`, 'x-device-token': dev.token },
  };
}

export const newShiftId = (): string => uuidv7();

export interface TxSeed {
  shiftId: string;
  outletId: string;
  deviceId: string;
  employeeId: string;
  total: number;
  method?: 'cash' | 'qris';
  status?: 'pending' | 'paid' | 'void_requested' | 'voided' | 'cancelled';
  createdAt?: Date;
  qrisConfirmation?: 'manual' | 'auto';
}

let txSeq = 1;
/** Insert a transaction directly (the transaction API is B-8); used to test shift totals. */
export async function seedTransaction(env: TestEnv, seed: TxSeed): Promise<string> {
  const { transactions, transactionItems, payments } = await import('../src/db/schema.js');
  const id = uuidv7();
  const method = seed.method ?? 'cash';
  const status = seed.status ?? 'paid';
  const createdAt = seed.createdAt ?? env.clock.now;
  await env.handle.db.insert(transactions).values({
    id,
    outletId: seed.outletId,
    shiftId: seed.shiftId,
    deviceId: seed.deviceId,
    employeeId: seed.employeeId,
    number: `T-K01-261026-${String(txSeq++).padStart(4, '0')}-${id.slice(-6)}`,
    status,
    paymentMethod: method,
    subtotal: seed.total,
    total: seed.total,
    clientCreatedAt: createdAt,
    paidAt: status === 'pending' || status === 'cancelled' ? null : createdAt,
  });
  await env.handle.db.insert(transactionItems).values({
    id: uuidv7(),
    transactionId: id,
    productName: 'Jus Alpukat',
    unitPrice: seed.total,
    quantity: 1,
    lineTotal: seed.total,
  });
  await env.handle.db.insert(payments).values({
    id: uuidv7(),
    transactionId: id,
    method,
    provider: method === 'cash' ? 'cash' : 'qris_static',
    status: status === 'pending' ? 'pending' : status === 'cancelled' ? 'cancelled' : 'paid',
    amount: seed.total,
    ...(method === 'cash' ? { cashTendered: seed.total, cashChange: 0 } : {}),
    ...(method === 'qris' ? { confirmationMode: seed.qrisConfirmation ?? 'manual' } : {}),
  });
  return id;
}
