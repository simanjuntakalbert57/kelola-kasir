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
});

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
  ownerAccessTtlSec: number;
  employeeAccessTtlSec: number;
  refreshTtlSec: number;
  pairingCodeTtlSec: number;
  ownerLockoutMax: number;
  ownerLockoutSec: number;
  pinLockoutMax: number;
  pinLockoutSec: number;
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
    ownerAccessTtlSec: 15 * 60,
    employeeAccessTtlSec: 12 * 60 * 60,
    refreshTtlSec: 30 * 24 * 60 * 60,
    pairingCodeTtlSec: 10 * 60,
    ownerLockoutMax: 5,
    ownerLockoutSec: 10 * 60,
    pinLockoutMax: 5,
    pinLockoutSec: 5 * 60,
  };
}
