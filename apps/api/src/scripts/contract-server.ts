import { randomBytes } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import { createDb } from '../db/client.js';
import { runMigrations } from '../db/migrate.js';
import { outletSettings, outlets } from '../db/schema.js';
import { TokenService } from '../lib/jwt.js';
import { OwnerAuthService } from '../modules/auth/owner-service.js';

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
    method: 'POST',
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

  writeFileSync(
    sessionFile,
    JSON.stringify({
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
