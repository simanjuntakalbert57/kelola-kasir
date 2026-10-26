import { randomBytes, randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import { createDb } from '../db/client.js';
import { runMigrations } from '../db/migrate.js';
import { outletSettings, outlets } from '../db/schema.js';
import { TokenService } from '../lib/jwt.js';
import { crc16 } from '../lib/qris.js';
import { OwnerAuthService } from '../modules/auth/owner-service.js';

const tlv = (tag: string, value: string): string =>
  `${tag}${String(value.length).padStart(2, '0')}${value}`;

/** A well-formed static QRIS payload (tag 01 = 11) with a valid CRC. */
function buildQris(): string {
  const body =
    tlv('00', '01') +
    tlv('01', '11') +
    tlv('26', tlv('00', 'ID.CO.QRIS.WWW') + tlv('01', 'ID1023456789012') + tlv('02', '93600000')) +
    tlv('52', '5814') +
    tlv('53', '360') +
    tlv('58', 'ID') +
    tlv('59', 'CONTRACT') +
    tlv('60', 'JAKARTA') +
    '6304';
  return body + crc16(body);
}

/**
 * Server for the OpenAPI contract test (tests/contract). Migrates the database, seeds one outlet,
 * owner, employee and paired device with throwaway credentials, then serves the real app and
 * writes the resulting tokens to CONTRACT_SESSION_FILE so schemathesis can authenticate.
 * Only run this against a disposable database (DATABASE_URL).
 */
async function main(): Promise<void> {
  const sessionFile = process.env['CONTRACT_SESSION_FILE'];
  if (!sessionFile) throw new Error('CONTRACT_SESSION_FILE is required');

  const config = {
    ...loadConfig({
      ...process.env,
      NODE_ENV: 'test',
      // Dummy object storage so POST /uploads is exercised; presigning is local, nothing is ever sent there.
      STORAGE_ENDPOINT: 'https://storage.contract.test',
      STORAGE_BUCKET: 'contract',
      STORAGE_ACCESS_KEY_ID: 'contract-access-key',
      STORAGE_SECRET_ACCESS_KEY: 'contract-secret-key',
      STORAGE_PUBLIC_BASE_URL: 'https://cdn.contract.test',
      LOG_LEVEL: process.env['LOG_LEVEL'] ?? 'warn',
      // The fuzzer sends hundreds of login/pair requests: rate limits would only add noise.
      RATE_LIMIT_LOGIN_MAX: '100000',
      RATE_LIMIT_PAIR_MAX: '100000',
    }),
  };
  const handle = createDb(config.databaseUrl);
  await runMigrations(handle.db);
  const app = await buildApp({ config, db: handle.db });

  const [outlet] = await handle.db
    .insert(outlets)
    .values({ code: 'CTRT', name: 'Contract Test Outlet' })
    .returning();
  if (!outlet) throw new Error('outlet seed failed');
  await handle.db.insert(outletSettings).values({ outletId: outlet.id, displayName: outlet.name });

  const ownerEmail = 'owner@contract.test';
  const ownerPassword = randomBytes(18).toString('base64url');
  await new OwnerAuthService({
    config,
    db: handle.db,
    tokens: new TokenService(config.jwtPrivateKeyPem),
    now: () => new Date(),
  }).createOwner({
    email: ownerEmail,
    password: ownerPassword,
    name: 'Contract Owner',
    outletId: outlet.id,
  });

  const call = async (
    method: 'POST' | 'PATCH',
    url: string,
    payload: object,
    headers: Record<string, string> = {},
  ) => {
    const res = await app.inject({ method, url, payload, headers });
    if (res.statusCode >= 300) throw new Error(`${method} ${url} -> ${res.statusCode} ${res.body}`);
    return res.json<Record<string, string>>();
  };

  const owner = await call('POST', '/v1/auth/login', {
    email: ownerEmail,
    password: ownerPassword,
  });
  const ownerAuth = { authorization: `Bearer ${owner['access_token']}` };
  const pin = '135792';
  const employee = await call('POST', '/v1/employees', { name: 'Contract Kasir', pin }, ownerAuth);
  const created = await call('POST', '/v1/devices', { name: 'Contract Device' }, ownerAuth);
  const paired = await call('POST', '/v1/devices/pair', {
    pairing_code: created['pairing_code'],
    app_version: '1.0.0',
    platform: 'android',
  });
  const deviceToken = paired['device_token'] as string;
  const session = await call(
    'POST',
    '/v1/auth/pin-login',
    { employee_id: employee['id'], pin },
    { 'x-device-token': deviceToken },
  );

  const employeeAuth = {
    authorization: `Bearer ${session['access_token']}`,
    'x-device-token': deviceToken,
  };

  // Shared fixtures so path-parameter operations reach real resources instead of 404 (see hooks.py).
  const qrisPayload = buildQris();
  await call('PATCH', '/v1/settings', { qris_static_payload: qrisPayload }, ownerAuth);
  const category = await call('POST', '/v1/categories', { name: 'Contract Jus' }, ownerAuth);
  const product = await call(
    'POST',
    '/v1/products',
    { category_id: category['id'], name: 'Contract Alpukat', price: 15000 },
    ownerAuth,
  );
  // Never handed to the fuzzer by id, so its price and availability stay valid for the sales below.
  const saleProduct = await call(
    'POST',
    '/v1/products',
    { category_id: category['id'], name: 'Contract Sale Item', price: 15000 },
    ownerAuth,
  );
  const shift = await call(
    'POST',
    '/v1/shifts',
    { id: randomUUID(), opening_cash: 100000, opened_at: new Date().toISOString() },
    employeeAuth,
  );
  const devices = await app.inject({ method: 'GET', url: '/v1/devices', headers: ownerAuth });
  const deviceCode = devices.json<{ data: { code: string }[] }>().data[0]?.code ?? 'K01';
  const sale = (method: 'cash' | 'qris', seq: number) => {
    const total = 15000;
    return {
      id: randomUUID(),
      shift_id: shift['id'],
      number: `CTRT-${deviceCode}-261026-${String(seq).padStart(4, '0')}`,
      client_created_at: new Date().toISOString(),
      items: [
        {
          id: randomUUID(),
          product_id: saleProduct['id'],
          product_name: saleProduct['name'],
          unit_price: 15000,
          quantity: 1,
          line_total: total,
        },
      ],
      subtotal: total,
      discount_amount: 0,
      tax_amount: 0,
      total,
      payment:
        method === 'cash'
          ? { id: randomUUID(), method, cash_tendered: total }
          : { id: randomUUID(), method },
    };
  };
  const cashSale = await call('POST', '/v1/transactions', sale('cash', 1), employeeAuth);
  const qrisSale = await call('POST', '/v1/transactions', sale('qris', 2), employeeAuth);

  writeFileSync(
    sessionFile,
    JSON.stringify({
      outlet_code: 'CTRT',
      qris_payload: qrisPayload,
      device_code: deviceCode,
      shift_id: shift['id'],
      category_id: category['id'],
      product_id: product['id'],
      sale_product_id: saleProduct['id'],
      sale_product_name: saleProduct['name'],
      transaction_id: cashSale['id'],
      qris_payment_id: (qrisSale['payments'] as unknown as { id: string }[])[0]?.id,
      base_url: `http://127.0.0.1:${config.port}/v1`,
      owner_email: ownerEmail,
      owner_password: ownerPassword,
      employee_id: employee['id'],
      employee_pin: pin,
      owner_token: owner['access_token'],
      device_token: deviceToken,
      employee_token: session['access_token'],
    }),
    { mode: 0o600 },
  );

  const shutdown = async (): Promise<void> => {
    await app.close();
    await handle.close();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown());
  process.on('SIGINT', () => void shutdown());
  await app.listen({ host: '127.0.0.1', port: config.port });
}

main().catch((err: unknown) => {
  console.error('contract server failed', err);
  process.exit(1);
});
