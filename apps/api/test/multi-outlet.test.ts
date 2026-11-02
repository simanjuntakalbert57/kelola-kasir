import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import webpush from 'web-push';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { notificationLog, outlets, pushSubscriptions } from '../src/db/schema.js';
import type { PushClient, PushResult } from '../src/modules/notifications/push-client.js';
import {
  bearer,
  createShop,
  createTestEnv,
  get,
  json,
  nextNumber,
  post,
  txBody,
  type TestEnv,
} from './helpers.js';
import {
  addMembership,
  createBranches,
  createMember,
  loginAs,
  switchTo,
  type Session,
} from './branch-helpers.js';

const storage = {
  endpoint: 'https://acct.r2.cloudflarestorage.com',
  bucket: 'media',
  accessKeyId: 'AKIDEXAMPLE',
  secretAccessKey: 'secret-example',
  region: 'auto',
  apiPublicBaseUrl: 'https://api.example',
};
class FakePush implements PushClient {
  async send(): Promise<PushResult> {
    return { ok: true, status: 201 };
  }
}
const keys = webpush.generateVAPIDKeys();

let env: TestEnv;
beforeAll(async () => {
  env = await createTestEnv(
    {
      storage,
      webPush: {
        publicKey: keys.publicKey,
        privateKey: keys.privateKey,
        subject: 'https://kelola-kasir.example.test',
      },
    },
    { pushClient: new FakePush() },
  );
});
afterAll(async () => {
  await env.close();
});

describe('owner session with several outlets (ADR-0020)', () => {
  it('returns the active outlet and the role and start date of every outlet', async () => {
    const f = await createBranches(env);
    const { session } = f.ownerA;
    expect(session.active_outlet_id).toBe(f.a.outletId);
    expect(session.user.outlets.map((o) => o.id).sort()).toEqual(
      [f.a.outletId, f.b.outletId].sort(),
    );
    expect(
      session.user.outlets.every((o) => o.role === 'owner' && o.operations_started_on === null),
    ).toBe(true);

    const asB = await loginAs(env, f.ownerA.email, f.b.outletId);
    expect(asB.session.active_outlet_id).toBe(f.b.outletId);
    const me = json<{ outlet_id: string; role: string }>(await get(env, '/v1/me', asB.headers));
    expect(me).toMatchObject({ outlet_id: f.b.outletId, role: 'owner' });
  });

  it('falls back to the primary outlet when the requested one is not a membership', async () => {
    const f = await createBranches(env);
    const stranger = await createShop(env, { qris: false });
    const login = await loginAs(env, f.ownerA.email, stranger.seeded.outletId);
    expect([f.a.outletId, f.b.outletId]).toContain(login.session.active_outlet_id);
    const solo = await loginAs(env, stranger.seeded.ownerEmail, f.a.outletId);
    expect(solo.session.active_outlet_id).toBe(stranger.seeded.outletId);
  });

  it('keeps the outlet on refresh when asked, and ignores a foreign one', async () => {
    const f = await createBranches(env);
    const res = await post(
      env,
      '/v1/auth/login',
      {},
      { email: f.ownerA.email, password: 'correct-horse-battery', outlet_id: f.a.outletId },
    );
    const cookie = res.cookies.find((c) => c.name === 'kk_refresh')?.value ?? '';
    const refresh = async (body?: object, token = cookie) =>
      env.app.inject({
        method: 'POST',
        url: '/v1/auth/refresh',
        cookies: { kk_refresh: token },
        ...(body ? { payload: body } : {}),
      });
    const first = await refresh({ outlet_id: f.b.outletId });
    expect(first.statusCode, first.body).toBe(200);
    expect(json<Session>(first).active_outlet_id).toBe(f.b.outletId);
    const next = first.cookies.find((c) => c.name === 'kk_refresh')?.value ?? '';
    const foreign = await refresh({ outlet_id: randomUUID() }, next);
    expect(foreign.statusCode).toBe(200);
    expect([f.a.outletId, f.b.outletId]).toContain(json<Session>(foreign).active_outlet_id);
    const bad = await refresh(
      { outlet_id: 'nope' },
      foreign.cookies.find((c) => c.name === 'kk_refresh')?.value ?? '',
    );
    expect(bad.statusCode).toBe(400);
  });

  it('switches outlet without rotating the refresh cookie, and the old token keeps its outlet', async () => {
    const f = await createBranches(env);
    const res = await post(env, '/v1/auth/switch-outlet', f.ownerA.headers, {
      outlet_id: f.b.outletId,
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.cookies.find((c) => c.name === 'kk_refresh')).toBeUndefined();
    const session = json<Session>(res);
    expect(session.active_outlet_id).toBe(f.b.outletId);
    const me = (headers: Record<string, string>) =>
      get(env, '/v1/me', headers).then((r) => json<{ outlet_id: string }>(r).outlet_id);
    expect(await me(bearer(session.access_token))).toBe(f.b.outletId);
    expect(await me(f.ownerA.headers)).toBe(f.a.outletId);
  });

  it('refuses a switch to an outlet the user is not a member of, and bad callers', async () => {
    const f = await createBranches(env);
    const stranger = await createShop(env, { qris: false });
    const denied = await post(env, '/v1/auth/switch-outlet', f.ownerA.headers, {
      outlet_id: stranger.seeded.outletId,
    });
    expect(denied.statusCode).toBe(403);
    expect(
      (await post(env, '/v1/auth/switch-outlet', f.ownerA.headers, { outlet_id: 'x' })).statusCode,
    ).toBe(400);
    expect(
      (await post(env, '/v1/auth/switch-outlet', {}, { outlet_id: f.b.outletId })).statusCode,
    ).toBe(401);
    expect(
      (
        await post(env, '/v1/auth/switch-outlet', stranger.cashier.headers, {
          outlet_id: stranger.seeded.outletId,
        })
      ).statusCode,
    ).toBe(403);
  });

  it('carries the role per outlet in the token', async () => {
    const f = await createBranches(env);
    const other = await createBranches(env);
    await addMembership(env, other.a.ownerEmail, f.b.outletId, 'manager');
    const login = await loginAs(env, other.a.ownerEmail, other.a.outletId);
    expect(login.session.user.outlets.find((o) => o.id === f.b.outletId)?.role).toBe('manager');
    const asManager = await switchTo(env, login.headers, f.b.outletId);
    expect(json<{ role: string }>(await get(env, '/v1/me', asManager)).role).toBe('manager');
  });
});

describe('transaction numbers after an outlet rename', () => {
  it('accepts the old code from previous_codes, the new code, and nothing else', async () => {
    const shop = await createShop(env, { qris: false });
    const oldCode = shop.seeded.code;
    const newCode = `R${randomUUID().slice(0, 4).toUpperCase()}`;
    const send = async (number: string) => {
      const body = { ...txBody(env, shop), number };
      return post(env, '/v1/transactions', shop.cashier.headers, body);
    };
    // Before the rename only the current code works.
    expect((await send(`${newCode}-${shop.device.code}-261102-0001`)).statusCode).toBe(400);

    await env.handle.db
      .update(outlets)
      .set({ code: newCode, previousCodes: [oldCode] })
      .where(eq(outlets.id, shop.seeded.outletId));
    const old = await send(nextNumber(shop)); // still numbered with the old code by the paired phone
    expect(old.statusCode, old.body).toBe(201);
    expect((await send(`${newCode}-${shop.device.code}-261102-0001`)).statusCode).toBe(201);
    expect((await send(`ZZZ-${shop.device.code}-261102-0001`)).statusCode).toBe(400);
    expect((await send(`${oldCode}-K99-261102-0001`)).statusCode).toBe(400);
  });
});

describe('POST /uploads expense_receipt', () => {
  const upload = (headers: Record<string, string>, over: object = {}) =>
    post(env, '/v1/uploads', headers, {
      purpose: 'expense_receipt',
      content_type: 'image/jpeg',
      size_bytes: 200_000,
      ...over,
    });

  it('allows up to 300 KiB and keys the object by the active outlet', async () => {
    const f = await createBranches(env);
    const ok = await upload(f.ownerA.headers, { size_bytes: 300 * 1024 });
    expect(ok.statusCode, ok.body).toBe(201);
    expect(json<{ public_url: string }>(ok).public_url).toMatch(
      new RegExp(
        `^https://api.example/v1/media/${f.a.outletId}/expense_receipt/[0-9a-f-]{36}\\.jpg$`,
      ),
    );
    expect((await upload(f.ownerA.headers, { size_bytes: 300 * 1024 + 1 })).statusCode).toBe(400);
    // Other purposes keep the 2 MiB limit.
    expect(
      (await upload(f.ownerA.headers, { purpose: 'logo', size_bytes: 1_000_000 })).statusCode,
    ).toBe(201);
  });

  it('uploads for another outlet of the caller, but never for a stranger or other purposes', async () => {
    const f = await createBranches(env);
    const stranger = await createShop(env, { qris: false });
    const forB = await upload(f.ownerA.headers, { outlet_id: f.b.outletId });
    expect(json<{ public_url: string }>(forB).public_url).toContain(
      `/${f.b.outletId}/expense_receipt/`,
    );
    expect(
      (await upload(f.ownerA.headers, { outlet_id: stranger.seeded.outletId })).statusCode,
    ).toBe(403);
    expect(
      (await upload(f.ownerA.headers, { purpose: 'logo', outlet_id: f.b.outletId })).statusCode,
    ).toBe(400);
    const manager = await createMember(env, f.a, 'manager');
    expect((await upload(manager.headers)).statusCode).toBe(201);
    expect((await upload(manager.headers, { outlet_id: f.b.outletId })).statusCode).toBe(403);
  });
});

describe('push notifications for an owner of several outlets (ADR-0020 §4)', () => {
  const subBody = () => ({
    endpoint: `https://fcm.googleapis.com/fcm/send/token-${randomUUID()}`,
    expirationTime: null,
    keys: {
      p256dh: Buffer.concat([Buffer.from([4]), Buffer.alloc(64, 7)]).toString('base64url'),
      auth: Buffer.alloc(16, 9).toString('base64url'),
    },
    label: 'Chrome di Windows',
  });
  const logs = (subscriptionId: string) =>
    env.handle.db
      .select()
      .from(notificationLog)
      .where(eq(notificationLog.subscriptionId, subscriptionId));

  async function twoShops() {
    const a = await createShop(env, { qris: false });
    const b = await createShop(env, { qris: false });
    await addMembership(env, a.seeded.ownerEmail, b.seeded.outletId, 'owner');
    const headersA = (await loginAs(env, a.seeded.ownerEmail, a.seeded.outletId)).headers;
    return { a, b, headersA };
  }
  const sell = async (shop: Awaited<ReturnType<typeof createShop>>) => {
    const res = await post(
      env,
      '/v1/transactions',
      shop.cashier.headers,
      txBody(env, shop, { qty: 3 }),
    );
    expect(res.statusCode, res.body).toBe(201);
    await env.app.notifier.idle();
  };

  it('delivers sales of every owned outlet to a browser registered from one of them, titled by branch', async () => {
    const s = await twoShops();
    const body = subBody();
    const created = await post(env, '/v1/notifications/push/subscriptions', s.headersA, body);
    expect(created.statusCode, created.body).toBe(201);
    const id = json<{ id: string }>(created).id;

    await sell(s.b);
    await sell(s.a);
    const rows = await logs(id);
    expect(rows).toHaveLength(2);
    const titles = rows.map((r) => (r.payload as { title: string }).title).sort();
    expect(titles).toEqual(
      [
        `Outlet ${s.a.seeded.code} · 💰 Transaksi masuk Rp45.000`,
        `Outlet ${s.b.seeded.code} · 💰 Transaksi masuk Rp45.000`,
      ].sort(),
    );
    expect(rows.find((r) => r.outletId === s.b.seeded.outletId)).toBeDefined();
  });

  it('does not prefix the branch for a single-outlet owner', async () => {
    const shop = await createShop(env, { qris: false });
    const headers = bearer(shop.ownerToken);
    const id = json<{ id: string }>(
      await post(env, '/v1/notifications/push/subscriptions', headers, subBody()),
    ).id;
    await sell(shop);
    const [row] = await logs(id);
    expect((row?.payload as { title: string }).title).toBe('💰 Transaksi masuk Rp45.000');
  });

  it('re-registering the same browser from another outlet updates it instead of replacing it', async () => {
    const s = await twoShops();
    const body = subBody();
    const first = json<{ id: string }>(
      await post(env, '/v1/notifications/push/subscriptions', s.headersA, body),
    );
    const headersB = await switchTo(env, s.headersA, s.b.seeded.outletId);
    const again = await post(env, '/v1/notifications/push/subscriptions', headersB, body);
    expect(again.statusCode, again.body).toBe(200);
    expect(json<{ id: string }>(again).id).toBe(first.id);
    const [row] = await env.handle.db
      .select()
      .from(pushSubscriptions)
      .where(eq(pushSubscriptions.id, first.id));
    expect(row).toMatchObject({ outletId: s.b.seeded.outletId, revokedAt: null });
    const list = json<{ items: { id: string }[] }>(
      await get(env, '/v1/notifications/push/subscriptions', headersB),
    );
    expect(list.items.map((i) => i.id)).toEqual([first.id]);
    // Another user registering the same endpoint still replaces it.
    const other = await createMember(env, s.a.seeded, 'owner');
    const taken = await post(env, '/v1/notifications/push/subscriptions', other.headers, body);
    expect(taken.statusCode).toBe(201);
  });

  it('does not notify a user who is only manager of the outlet of the sale', async () => {
    const s = await twoShops();
    const other = await createBranches(env);
    await addMembership(env, other.a.ownerEmail, s.b.seeded.outletId, 'manager');
    const headers = (await loginAs(env, other.a.ownerEmail, other.a.outletId)).headers;
    const id = json<{ id: string }>(
      await post(env, '/v1/notifications/push/subscriptions', headers, subBody()),
    ).id;
    await sell(s.b);
    expect(await logs(id)).toHaveLength(0);
  });
});
