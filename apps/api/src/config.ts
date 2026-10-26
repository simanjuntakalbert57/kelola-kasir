import { generateKeyPairSync } from 'node:crypto';
import { z } from 'zod';

const booleanFromEnv = z
  .enum(['true', 'false', '1', '0'])
  .transform((value) => value === 'true' || value === '1');

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().default('0.0.0.0'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  DATABASE_URL: z.string().min(1),
  /** Base64 of a PKCS#8 PEM Ed25519 private key (`pnpm --filter @kelola-kasir/api keys:generate`). */
  JWT_PRIVATE_KEY: z.string().optional(),
  /** Secret used to fingerprint PINs so they can be unique per outlet. At least 32 characters. */
  PIN_FINGERPRINT_SECRET: z.string().min(32).optional(),
  COOKIE_SECURE: booleanFromEnv.optional(),
  TRUST_PROXY: booleanFromEnv.default(false),
  CORS_ORIGINS: z.string().default(''),
  RATE_LIMIT_LOGIN_MAX: z.coerce.number().int().min(1).default(5),
  RATE_LIMIT_PAIR_MAX: z.coerce.number().int().min(1).default(10),
  /** S3-compatible object storage (Cloudflare R2) for presigned image uploads. All or nothing. */
  STORAGE_ENDPOINT: z.url().optional(),
  STORAGE_BUCKET: z.string().min(1).optional(),
  STORAGE_ACCESS_KEY_ID: z.string().min(1).optional(),
  STORAGE_SECRET_ACCESS_KEY: z.string().min(1).optional(),
  STORAGE_REGION: z.string().min(1).default('auto'),
  /** Public base URL the uploaded objects are served from (R2 public bucket / custom domain). */
  STORAGE_PUBLIC_BASE_URL: z.url().optional(),
});

export interface StorageConfig {
  endpoint: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
  publicBaseUrl: string;
}

export interface Config {
  env: 'development' | 'test' | 'production';
  host: string;
  port: number;
  logLevel: string;
  databaseUrl: string;
  /** PEM, PKCS#8, Ed25519. */
  jwtPrivateKeyPem: string;
  pinFingerprintSecret: string;
  cookieSecure: boolean;
  trustProxy: boolean;
  corsOrigins: string[];
  rateLimit: { loginMax: number; pairMax: number };
  /** `null` when object storage is not configured: `POST /uploads` then answers 503. */
  storage: StorageConfig | null;
  ownerAccessTtlSec: number;
  employeeAccessTtlSec: number;
  refreshTtlSec: number;
  pairingCodeTtlSec: number;
  ownerLockoutMax: number;
  ownerLockoutSec: number;
  pinLockoutMax: number;
  pinLockoutSec: number;
  /** A pending QRIS payment expires (transaction `cancelled`) after this many seconds. */
  qrisExpirySec: number;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid environment: ${problems}`);
  }
  const e = parsed.data;
  const production = e.NODE_ENV === 'production';

  let jwtPrivateKeyPem: string;
  if (e.JWT_PRIVATE_KEY) {
    jwtPrivateKeyPem = Buffer.from(e.JWT_PRIVATE_KEY, 'base64').toString('utf8');
  } else if (production) {
    throw new Error('Invalid environment: JWT_PRIVATE_KEY is required in production');
  } else {
    // Ephemeral key for local development and tests: tokens do not survive a restart.
    jwtPrivateKeyPem = generateKeyPairSync('ed25519')
      .privateKey.export({ type: 'pkcs8', format: 'pem' })
      .toString();
  }

  let pinFingerprintSecret = e.PIN_FINGERPRINT_SECRET;
  if (!pinFingerprintSecret) {
    if (production) {
      throw new Error('Invalid environment: PIN_FINGERPRINT_SECRET is required in production');
    }
    pinFingerprintSecret = 'development-only-pin-fingerprint-secret-change-me';
  }

  const storageValues = [
    e.STORAGE_ENDPOINT,
    e.STORAGE_BUCKET,
    e.STORAGE_ACCESS_KEY_ID,
    e.STORAGE_SECRET_ACCESS_KEY,
    e.STORAGE_PUBLIC_BASE_URL,
  ];
  let storage: StorageConfig | null = null;
  if (storageValues.some(Boolean)) {
    if (
      !e.STORAGE_ENDPOINT ||
      !e.STORAGE_BUCKET ||
      !e.STORAGE_ACCESS_KEY_ID ||
      !e.STORAGE_SECRET_ACCESS_KEY ||
      !e.STORAGE_PUBLIC_BASE_URL
    ) {
      throw new Error(
        'Invalid environment: STORAGE_ENDPOINT, STORAGE_BUCKET, STORAGE_ACCESS_KEY_ID, STORAGE_SECRET_ACCESS_KEY and STORAGE_PUBLIC_BASE_URL must be set together',
      );
    }
    storage = {
      endpoint: e.STORAGE_ENDPOINT.replace(/\/+$/, ''),
      bucket: e.STORAGE_BUCKET,
      accessKeyId: e.STORAGE_ACCESS_KEY_ID,
      secretAccessKey: e.STORAGE_SECRET_ACCESS_KEY,
      region: e.STORAGE_REGION,
      publicBaseUrl: e.STORAGE_PUBLIC_BASE_URL.replace(/\/+$/, ''),
    };
  }

  return {
    env: e.NODE_ENV,
    host: e.HOST,
    port: e.PORT,
    logLevel: e.LOG_LEVEL,
    databaseUrl: e.DATABASE_URL,
    jwtPrivateKeyPem,
    pinFingerprintSecret,
    cookieSecure: e.COOKIE_SECURE ?? production,
    trustProxy: e.TRUST_PROXY,
    corsOrigins: e.CORS_ORIGINS.split(',')
      .map((o) => o.trim())
      .filter(Boolean),
    rateLimit: { loginMax: e.RATE_LIMIT_LOGIN_MAX, pairMax: e.RATE_LIMIT_PAIR_MAX },
    storage,
    ownerAccessTtlSec: 15 * 60,
    employeeAccessTtlSec: 12 * 60 * 60,
    refreshTtlSec: 30 * 24 * 60 * 60,
    pairingCodeTtlSec: 10 * 60,
    ownerLockoutMax: 5,
    ownerLockoutSec: 10 * 60,
    pinLockoutMax: 5,
    pinLockoutSec: 5 * 60,
    qrisExpirySec: 15 * 60,
  };
}
