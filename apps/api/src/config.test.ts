import webpush from 'web-push';
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

  it('treats empty variables as unset', () => {
    const config = loadConfig({
      ...base,
      SENTRY_DSN: '',
      STORAGE_ENDPOINT: '',
      STORAGE_BUCKET: '',
      STORAGE_ACCESS_KEY_ID: '',
      STORAGE_SECRET_ACCESS_KEY: '',
      STORAGE_PUBLIC_BASE_URL: '',
      API_PUBLIC_BASE_URL: '',
      COOKIE_SECURE: '',
    });
    expect(config.sentry).toBeNull();
    expect(config.storage).toBeNull();
    expect(config.cookieSecure).toBe(false);
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
    API_PUBLIC_BASE_URL: 'https://app.example/',
  };

  it('is off by default', () => {
    expect(loadConfig(base).storage).toBeNull();
  });

  it('normalises trailing slashes and defaults the region', () => {
    expect(loadConfig({ ...base, ...storage }).storage).toMatchObject({
      endpoint: 'https://acct.r2.cloudflarestorage.com',
      apiPublicBaseUrl: 'https://app.example',
      region: 'auto',
    });
    expect(loadConfig({ ...base, ...storage }).storage?.publicBaseUrl).toBeUndefined();
  });

  it('keeps the legacy public bucket URL optional', () => {
    expect(
      loadConfig({ ...base, ...storage, STORAGE_PUBLIC_BASE_URL: 'https://media.example/' }).storage
        ?.publicBaseUrl,
    ).toBe('https://media.example');
  });

  it('requires the API public base URL once storage is configured', () => {
    expect(() => loadConfig({ ...base, ...storage, API_PUBLIC_BASE_URL: '' })).toThrow(
      /API_PUBLIC_BASE_URL/,
    );
  });

  it('is all or nothing', () => {
    expect(() => loadConfig({ ...base, STORAGE_BUCKET: 'media' })).toThrow(/must be set together/);
  });
});

describe('web push (VAPID) config', () => {
  const base = { DATABASE_URL: 'postgres://localhost/db' };
  const keys = webpush.generateVAPIDKeys();
  const vapid = {
    VAPID_PUBLIC_KEY: keys.publicKey,
    VAPID_PRIVATE_KEY: keys.privateKey,
    VAPID_SUBJECT: 'https://kelola-kasir.pages.dev',
  };

  it('is off when no VAPID variable is set', () => {
    expect(loadConfig(base).webPush).toBeNull();
    expect(
      loadConfig({ ...base, VAPID_PUBLIC_KEY: '', VAPID_PRIVATE_KEY: '', VAPID_SUBJECT: '' })
        .webPush,
    ).toBeNull();
  });

  it('accepts a complete, matching set', () => {
    expect(loadConfig({ ...base, ...vapid }).webPush).toEqual({
      publicKey: keys.publicKey,
      privateKey: keys.privateKey,
      subject: 'https://kelola-kasir.pages.dev',
    });
  });

  it('rejects a partial set', () => {
    expect(() => loadConfig({ ...base, VAPID_PUBLIC_KEY: keys.publicKey })).toThrow(
      /must be set together/,
    );
  });

  it('rejects malformed or mismatched keys without echoing them', () => {
    expect(() => loadConfig({ ...base, ...vapid, VAPID_PUBLIC_KEY: 'abc' })).toThrow(/65 bytes/);
    expect(() => loadConfig({ ...base, ...vapid, VAPID_PRIVATE_KEY: 'abc' })).toThrow(/32 bytes/);
    const other = webpush.generateVAPIDKeys();
    let message = '';
    try {
      loadConfig({ ...base, ...vapid, VAPID_PUBLIC_KEY: other.publicKey });
    } catch (err) {
      message = (err as Error).message;
    }
    expect(message).toMatch(/does not match/);
    expect(message).not.toContain(keys.privateKey);
  });
});
