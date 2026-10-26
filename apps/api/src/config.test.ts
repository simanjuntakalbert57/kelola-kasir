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
