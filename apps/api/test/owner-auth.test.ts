import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { desc, eq } from 'drizzle-orm';
import { TokenService } from '../src/lib/jwt.js';
import { auditLogs, refreshTokens, users } from '../src/db/schema.js';
import {
  OWNER_PASSWORD,
  bearer,
  createTestEnv,
  json,
  loginOwner,
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

const login = (email: string, password: string) =>
  env.app.inject({ method: 'POST', url: '/v1/auth/login', payload: { email, password } });

describe('owner login', () => {
  let seeded: SeededOutlet;
  beforeAll(async () => {
    seeded = await seedOutlet(env);
  });

  it('returns a session, outlets and an HttpOnly refresh cookie', async () => {
    const res = await login(seeded.ownerEmail.toUpperCase(), OWNER_PASSWORD);
    expect(res.statusCode).toBe(200);
    const body = json<{
      access_token: string;
      expires_in: number;
      user: { email: string; outlets: { id: string; code: string }[] };
    }>(res);
    expect(body.expires_in).toBe(900);
    expect(body.user.email).toBe(seeded.ownerEmail);
    expect(body.user.outlets).toEqual([
      expect.objectContaining({ id: seeded.outletId, code: seeded.code }),
    ]);
    const cookie = res.cookies.find((c) => c.name === 'kk_refresh');
    expect(cookie).toMatchObject({ httpOnly: true, sameSite: 'Strict', path: '/v1/auth' });
    expect(res.body).not.toContain('password');
  });

  it('rejects a wrong password and an unknown email with the same problem', async () => {
    const wrong = await login(seeded.ownerEmail, 'not-the-password');
    const unknown = await login('nobody@example.test', 'not-the-password');
    for (const res of [wrong, unknown]) {
      expect(res.statusCode).toBe(401);
      expect(res.headers['content-type']).toContain('application/problem+json');
      expect(json(res)).toMatchObject({ status: 401, code: 'INVALID_CREDENTIALS' });
    }
  });

  it('validates the body with problem+json', async () => {
    const res = await login('not-an-email', 'short');
    expect(res.statusCode).toBe(400);
    expect(json<{ code: string; errors: { path: string }[] }>(res)).toMatchObject({
      code: 'VALIDATION_ERROR',
      errors: expect.arrayContaining([expect.objectContaining({ path: 'email' })]),
    });
  });

  it('exposes the principal on /me', async () => {
    const { token } = await loginOwner(env, seeded);
    const res = await env.app.inject({ method: 'GET', url: '/v1/me', headers: bearer(token) });
    expect(res.statusCode).toBe(200);
    expect(json(res)).toMatchObject({
      type: 'user',
      role: 'owner',
      outlet_id: seeded.outletId,
      device_id: null,
    });
  });

  it('rejects missing, garbage and expired tokens', async () => {
    expect((await env.app.inject({ method: 'GET', url: '/v1/me' })).statusCode).toBe(401);
    expect(
      (await env.app.inject({ method: 'GET', url: '/v1/me', headers: bearer('garbage') }))
        .statusCode,
    ).toBe(401);
    const expired = await new TokenService(env.config.jwtPrivateKeyPem).signOwner(
      { sub: randomUUID(), oid: seeded.outletId, role: 'owner' },
      -10,
    );
    const res = await env.app.inject({ method: 'GET', url: '/v1/me', headers: bearer(expired) });
    expect(res.statusCode).toBe(401);
  });
});

describe('owner lockout', () => {
  it('locks for 10 minutes after 5 wrong passwords, even for the right password', async () => {
    const seeded = await seedOutlet(env);
    for (let i = 0; i < 4; i += 1) {
      expect((await login(seeded.ownerEmail, 'wrong-password')).statusCode).toBe(401);
    }
    const fifth = await login(seeded.ownerEmail, 'wrong-password');
    expect(fifth.statusCode).toBe(429);
    expect(json(fifth)).toMatchObject({ code: 'ACCOUNT_LOCKED' });
    expect(fifth.headers['retry-after']).toBe('600');

    const correct = await login(seeded.ownerEmail, OWNER_PASSWORD);
    expect(correct.statusCode).toBe(429);

    env.clock.advance(10 * 60 * 1000 + 1000);
    const after = await login(seeded.ownerEmail, OWNER_PASSWORD);
    expect(after.statusCode).toBe(200);
    const [user] = await env.handle.db
      .select()
      .from(users)
      .where(eq(users.email, seeded.ownerEmail));
    expect(user).toMatchObject({ failedLoginCount: 0, lockedUntil: null });

    const [audit] = await env.handle.db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.outletId, seeded.outletId))
      .orderBy(desc(auditLogs.createdAt));
    expect(audit?.action).toBe('auth.owner_locked');
  });

  it('counts a fresh streak after the lock expired', async () => {
    const seeded = await seedOutlet(env);
    for (let i = 0; i < 5; i += 1) await login(seeded.ownerEmail, 'wrong-password');
    env.clock.advance(11 * 60 * 1000);
    expect((await login(seeded.ownerEmail, 'wrong-password')).statusCode).toBe(401);
    expect((await login(seeded.ownerEmail, OWNER_PASSWORD)).statusCode).toBe(200);
  });
});

describe('refresh token rotation', () => {
  it('rotates the cookie and the old token stops working', async () => {
    const seeded = await seedOutlet(env);
    const { cookie } = await loginOwner(env, seeded);
    const first = await env.app.inject({
      method: 'POST',
      url: '/v1/auth/refresh',
      cookies: { kk_refresh: cookie ?? '' },
    });
    expect(first.statusCode).toBe(200);
    const rotated = first.cookies.find((c) => c.name === 'kk_refresh')?.value;
    expect(rotated).toBeTruthy();
    expect(rotated).not.toBe(cookie);
    expect(json<{ access_token: string }>(first).access_token).toBeTruthy();

    const second = await env.app.inject({
      method: 'POST',
      url: '/v1/auth/refresh',
      cookies: { kk_refresh: rotated ?? '' },
    });
    expect(second.statusCode).toBe(200);
  });

  it('reuse of a rotated token revokes the whole family', async () => {
    const seeded = await seedOutlet(env);
    const { cookie } = await loginOwner(env, seeded);
    const rotated = await env.app.inject({
      method: 'POST',
      url: '/v1/auth/refresh',
      cookies: { kk_refresh: cookie ?? '' },
    });
    const latest = rotated.cookies.find((c) => c.name === 'kk_refresh')?.value ?? '';

    const replay = await env.app.inject({
      method: 'POST',
      url: '/v1/auth/refresh',
      cookies: { kk_refresh: cookie ?? '' },
    });
    expect(replay.statusCode).toBe(401);
    // The legitimate, newest token is now dead too.
    const afterReuse = await env.app.inject({
      method: 'POST',
      url: '/v1/auth/refresh',
      cookies: { kk_refresh: latest },
    });
    expect(afterReuse.statusCode).toBe(401);
  });

  it('rejects a missing, unknown or expired refresh token', async () => {
    const seeded = await seedOutlet(env);
    expect((await env.app.inject({ method: 'POST', url: '/v1/auth/refresh' })).statusCode).toBe(
      401,
    );
    expect(
      (
        await env.app.inject({
          method: 'POST',
          url: '/v1/auth/refresh',
          cookies: { kk_refresh: 'nope' },
        })
      ).statusCode,
    ).toBe(401);
    const { cookie } = await loginOwner(env, seeded);
    env.clock.advance(31 * 24 * 60 * 60 * 1000);
    expect(
      (
        await env.app.inject({
          method: 'POST',
          url: '/v1/auth/refresh',
          cookies: { kk_refresh: cookie ?? '' },
        })
      ).statusCode,
    ).toBe(401);
  });

  it('stores only a hash of the refresh token', async () => {
    const seeded = await seedOutlet(env);
    const { cookie } = await loginOwner(env, seeded);
    const rows = await env.handle.db.select().from(refreshTokens);
    expect(rows.some((r) => r.tokenHash === cookie)).toBe(false);
  });

  it('logout revokes the refresh family and clears the cookie', async () => {
    const seeded = await seedOutlet(env);
    const { token, cookie } = await loginOwner(env, seeded);
    const out = await env.app.inject({
      method: 'POST',
      url: '/v1/auth/logout',
      headers: bearer(token),
      cookies: { kk_refresh: cookie ?? '' },
    });
    expect(out.statusCode).toBe(204);
    const again = await env.app.inject({
      method: 'POST',
      url: '/v1/auth/refresh',
      cookies: { kk_refresh: cookie ?? '' },
    });
    expect(again.statusCode).toBe(401);
    expect((await env.app.inject({ method: 'POST', url: '/v1/auth/logout' })).statusCode).toBe(401);
  });
});

describe('rate limiting', () => {
  it('limits owner login attempts per IP', async () => {
    const limited = await createTestEnv({ rateLimit: { loginMax: 3, pairMax: 1000 } });
    try {
      const statuses: number[] = [];
      for (let i = 0; i < 5; i += 1) {
        const res = await limited.app.inject({
          method: 'POST',
          url: '/v1/auth/login',
          payload: { email: 'nobody@example.test', password: 'whatever-password' },
        });
        statuses.push(res.statusCode);
        if (res.statusCode === 429) {
          expect(res.headers['content-type']).toContain('application/problem+json');
          expect(json(res)).toMatchObject({ code: 'RATE_LIMITED', status: 429 });
        }
      }
      expect(statuses).toEqual([401, 401, 401, 429, 429]);
    } finally {
      await limited.close();
    }
  });
});
