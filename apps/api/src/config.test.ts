import { describe, expect, it } from 'vitest';
import { loadConfig } from './config.js';

describe('loadConfig', () => {
  const base = { DATABASE_URL: 'postgres://localhost/db' };

  it('applies development defaults and generates an ephemeral signing key', () => {
    const config = loadConfig({ ...base, NODE_ENV: 'development' });
    expect(config).toMatchObject({
      port: 3000,
      cookieSecure: false,
      ownerAccessTtlSec: 900,
      employeeAccessTtlSec: 43_200,
    });
    expect(config.jwtPrivateKeyPem).toContain('BEGIN PRIVATE KEY');
  });

  it('requires secrets in production and sets Secure cookies', () => {
    expect(() => loadConfig({ ...base, NODE_ENV: 'production' })).toThrow(/JWT_PRIVATE_KEY/);
    const key = Buffer.from(loadConfig({ ...base }).jwtPrivateKeyPem).toString('base64');
    expect(() => loadConfig({ ...base, NODE_ENV: 'production', JWT_PRIVATE_KEY: key })).toThrow(
      /PIN_FINGERPRINT_SECRET/,
    );
    const config = loadConfig({
      ...base,
      NODE_ENV: 'production',
      JWT_PRIVATE_KEY: key,
      PIN_FINGERPRINT_SECRET: 'x'.repeat(32),
    });
    expect(config.cookieSecure).toBe(true);
  });

  it('parses deployment settings (ADR-0011)', () => {
    expect(loadConfig({ ...base, TRUST_PROXY: '1' }).trustProxy).toBe(1);
    expect(loadConfig({ ...base, TRUST_PROXY: 'true' }).trustProxy).toBe(true);
    expect(loadConfig({ ...base }).dbPoolMax).toBe(5);
    expect(loadConfig({ ...base }).sentry).toBeNull();
    expect(
      loadConfig({ ...base, SENTRY_DSN: 'https://k@o1.ingest.sentry.io/1', NODE_ENV: 'test' })
        .sentry,
    ).toEqual({ dsn: 'https://k@o1.ingest.sentry.io/1', environment: 'test' });
    expect(() => loadConfig({ ...base, PROXY_SHARED_SECRET: 'short' })).toThrow(
      /PROXY_SHARED_SECRET/,
    );
  });

  it('rejects an invalid environment', () => {
    expect(() => loadConfig({})).toThrow(/DATABASE_URL/);
    expect(() => loadConfig({ ...base, PORT: 'abc' })).toThrow(/PORT/);
  });

  it('parses CORS origins', () => {
    expect(
      loadConfig({ ...base, CORS_ORIGINS: 'https://a.example, https://b.example' }).corsOrigins,
    ).toEqual(['https://a.example', 'https://b.example']);
  });
});

describe('object storage config', () => {
  const base = { DATABASE_URL: 'postgres://localhost/db' };
  const storage = {
    STORAGE_ENDPOINT: 'https://acct.r2.cloudflarestorage.com/',
    STORAGE_BUCKET: 'media',
    STORAGE_ACCESS_KEY_ID: 'key',
    STORAGE_SECRET_ACCESS_KEY: 'secret',
    STORAGE_PUBLIC_BASE_URL: 'https://media.example/',
  };

  it('is off by default', () => {
    expect(loadConfig(base).storage).toBeNull();
  });

  it('normalises trailing slashes and defaults the region', () => {
    expect(loadConfig({ ...base, ...storage }).storage).toMatchObject({
      endpoint: 'https://acct.r2.cloudflarestorage.com',
      publicBaseUrl: 'https://media.example',
      region: 'auto',
    });
  });

  it('is all or nothing', () => {
    expect(() => loadConfig({ ...base, STORAGE_BUCKET: 'media' })).toThrow(/must be set together/);
  });
});
