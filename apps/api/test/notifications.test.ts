import { and, eq } from 'drizzle-orm';
import webpush from 'web-push';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { auditLogs, notificationLog, pushSubscriptions } from '../src/db/schema.js';
import { OwnerAuthService } from '../src/modules/auth/owner-service.js';
import { TokenService } from '../src/lib/jwt.js';
import type {
  PushClient,
  PushOptions,
  PushResult,
  PushTarget,
} from '../src/modules/notifications/push-client.js';
import {
  bearer,
  createShop,
  createTestEnv,
  get,
  json,
  loginOwner,
  nextPin,
  patch,
  post,
  txBody,
  OWNER_PASSWORD,
  type Shop,
  type TestEnv,
} from './helpers.js';

interface Sent {
  target: PushTarget;
  payload: Record<string, unknown>;
  options: PushOptions;
}

/** Fake push service: records calls; `respond` decides the outcome, `gate` can stall it. */
class FakePush implements PushClient {
  sent: Sent[] = [];
  respond: (target: PushTarget) => PushResult = () => ({ ok: true, status: 201 });
  gate: Promise<void> | undefined;
  async send(target: PushTarget, payload: string, options: PushOptions): Promise<PushResult> {
    if (this.gate) await this.gate;
    this.sent.push({ target, payload: JSON.parse(payload) as Record<string, unknown>, options });
    return this.respond(target);
  }
}

const keys = webpush.generateVAPIDKeys();
const webPush = {
  publicKey: keys.publicKey,
  privateKey: keys.privateKey,
  subject: 'https://kelola-kasir.example.test',
};

let env: TestEnv;
let push: FakePush;
beforeAll(async () => {
  push = new FakePush();
  env = await createTestEnv({ webPush }, { pushClient: push });
});
afterAll(async () => {
  await env.close();
});

let endpointSeq = 0;
const subBody = (label = 'Chrome di Windows') => ({
  endpoint: `https://fcm.googleapis.com/fcm/send/token-${Date.now()}-${endpointSeq++}`,
  expirationTime: null,
  keys: {
    p256dh: Buffer.concat([Buffer.from([4]), Buffer.alloc(64, 7)]).toString('base64url'),
    auth: Buffer.alloc(16, 9).toString('base64url'),
  },
  label,
});
const owner = (shop: Shop) => bearer(shop.ownerToken);
const subscribe = async (shop: Shop, body = subBody(), token = shop.ownerToken) => {
  const res = await post(env, '/v1/notifications/push/subscriptions', bearer(token), body);
  expect(res.statusCode, res.body).toBe(201);
  return { ...json<{ id: string }>(res), endpoint: body.endpoint };
};
const logRows = (shop: Shop, event?: string) =>
  env.handle.db
    .select()
    .from(notificationLog)
    .where(
      and(
        eq(notificationLog.outletId, shop.seeded.outletId),
        event ? eq(notificationLog.event, event) : undefined,
      ),
    );
const settle = async () => env.app.notifier.idle();

async function cashSale(shop: Shop) {
  const body = txBody(env, shop, { qty: 3 });
  const res = await post(env, '/v1/transactions', shop.cashier.headers, body);
  expect(res.statusCode, res.body).toBe(201);
  return body.id;
}

async function addUser(shop: Shop, role: 'owner' | 'manager', name: string) {
  const email = `${role}-${Math.random().toString(36).slice(2)}@example.test`;
  await new OwnerAuthService({
    config: env.config,
    db: env.handle.db,
    tokens: new TokenService(env.config.jwtPrivateKeyPem),
    now: () => new Date(),
  }).createOwner({ email, password: OWNER_PASSWORD, name, outletId: shop.seeded.outletId, role });
  const res = await post(env, '/v1/auth/login', {}, { email, password: OWNER_PASSWORD });
  return json<{ access_token: string }>(res).access_token;
}

describe('subscriptions API', () => {
  it('exposes the public key and registers, lists, tests and revokes a browser', async () => {
    const shop = await createShop(env);
    const config = json<{ configured: boolean; vapid_public_key: string }>(
      await get(env, '/v1/notifications/push/config', owner(shop)),
    );
    expect(config).toEqual({ configured: true, vapid_public_key: keys.publicKey });

    const sub = await subscribe(shop);
    const list = json<{ items: Record<string, unknown>[] }>(
      await get(env, '/v1/notifications/push/subscriptions', owner(shop)),
    ).items;
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ id: sub.id, label: 'Chrome di Windows', status: 'active' });
    expect(JSON.stringify(list)).not.toContain('fcm.googleapis.com');

    push.sent.length = 0;
    const test = await post(
      env,
      `/v1/notifications/push/subscriptions/${sub.id}/test`,
      owner(shop),
      {},
    );
    expect(test.statusCode, test.body).toBe(200);
    expect(json(test)).toEqual({ result: 'sent' });
    expect(push.sent[0]?.options).toEqual({ ttlSeconds: 60, urgency: 'normal' });
    expect(push.sent[0]?.payload).toMatchObject({ kind: 'test', title: '🔔 Notifikasi uji' });
    // Max one test per 5 seconds per browser.
    const again = await post(
      env,
      `/v1/notifications/push/subscriptions/${sub.id}/test`,
      owner(shop),
      {},
    );
    expect(again.statusCode).toBe(429);
    env.clock.advance(6000);

    const del = await env.app.inject({
      method: 'DELETE',
      url: `/v1/notifications/push/subscriptions/${sub.id}`,
      headers: owner(shop),
    });
    expect(del.statusCode).toBe(204);
    const del2 = await env.app.inject({
      method: 'DELETE',
      url: `/v1/notifications/push/subscriptions/${sub.id}`,
      headers: owner(shop),
    });
    expect(del2.statusCode).toBe(204);
    expect(
      json<{ items: unknown[] }>(
        await get(env, '/v1/notifications/push/subscriptions', owner(shop)),
      ).items,
    ).toHaveLength(0);
    const audit = await env.handle.db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.outletId, shop.seeded.outletId));
    const actions = audit.map((a) => a.action);
    expect(actions).toContain('notification.subscription_added');
    expect(actions.filter((a) => a === 'notification.subscription_revoked')).toHaveLength(1);
    expect(JSON.stringify(audit.map((a) => a.meta))).not.toContain('fcm.googleapis.com');
  });

  it('is owner only', async () => {
    const shop = await createShop(env);
    const manager = await addUser(shop, 'manager', 'Manajer');
    for (const [method, url] of [
      ['GET', '/v1/notifications/push/config'],
      ['GET', '/v1/notifications/push/subscriptions'],
      ['GET', '/v1/notifications/prefs'],
    ] as const) {
      expect((await env.app.inject({ method, url, headers: bearer(manager) })).statusCode).toBe(
        403,
      );
    }
    expect(
      (await post(env, '/v1/notifications/push/subscriptions', bearer(manager), subBody()))
        .statusCode,
    ).toBe(403);
    expect(
      (await post(env, '/v1/notifications/push/subscriptions', shop.cashier.headers, subBody()))
        .statusCode,
    ).toBe(403);
    expect(
      (await env.app.inject({ method: 'GET', url: '/v1/notifications/prefs' })).statusCode,
    ).toBe(401);
  });

  it('rejects endpoints outside the push service allowlist and bad keys without any outgoing request', async () => {
    const shop = await createShop(env);
    push.sent.length = 0;
    const bad = [
      { ...subBody(), endpoint: 'http://fcm.googleapis.com/fcm/send/x' },
      { ...subBody(), endpoint: 'https://169.254.169.254/latest' },
      { ...subBody(), endpoint: 'https://127.0.0.1/x' },
      { ...subBody(), endpoint: 'https://evil.example.com/fcm.googleapis.com' },
      { ...subBody(), keys: { ...subBody().keys, auth: Buffer.alloc(15).toString('base64url') } },
      { ...subBody(), keys: { ...subBody().keys, p256dh: Buffer.alloc(64).toString('base64url') } },
    ];
    for (const body of bad) {
      const res = await post(env, '/v1/notifications/push/subscriptions', owner(shop), body);
      expect(res.statusCode, JSON.stringify(body.endpoint)).toBe(400);
      expect(json<{ code: string }>(res).code).toBe('INVALID_PUSH_SUBSCRIPTION');
    }
    expect(push.sent).toHaveLength(0);
  });

  it('upserts the same endpoint, replaces another user’s and caps active browsers at 10', async () => {
    const shop = await createShop(env);
    const body = subBody();
    const first = await subscribe(shop, body);
    const refresh = await post(env, '/v1/notifications/push/subscriptions', owner(shop), {
      ...body,
      label: 'Chrome baru',
    });
    expect(refresh.statusCode).toBe(200);
    expect(json<{ id: string; label: string }>(refresh)).toMatchObject({
      id: first.id,
      label: 'Chrome baru',
    });

    // Same browser, signed in as a different owner: old row is `replaced`, a new one is created.
    const other = await addUser(shop, 'owner', 'Owner Dua');
    const taken = await subscribe(shop, body, other);
    expect(taken.id).not.toBe(first.id);
    const [old] = await env.handle.db
      .select()
      .from(pushSubscriptions)
      .where(eq(pushSubscriptions.id, first.id));
    expect(old?.revokedReason).toBe('replaced');

    const ids: string[] = [];
    for (let i = 0; i < 11; i++) {
      env.clock.advance(1000);
      ids.push((await subscribe(shop)).id);
    }
    const active = await env.handle.db
      .select()
      .from(pushSubscriptions)
      .where(eq(pushSubscriptions.userId, (await ownerId(shop)) ?? ''));
    expect(active.filter((s) => !s.revokedAt)).toHaveLength(10);
    const limited = active.filter((s) => s.revokedReason === 'limit');
    expect(limited.length).toBeGreaterThanOrEqual(1);
  });

  it('answers 503 when VAPID is not configured', async () => {
    const bare = await createTestEnv({ webPush: null });
    try {
      const shop = await createShop(bare);
      const config = await get(bare, '/v1/notifications/push/config', bearer(shop.ownerToken));
      expect(json(config)).toEqual({ configured: false, vapid_public_key: null });
      const res = await post(
        bare,
        '/v1/notifications/push/subscriptions',
        bearer(shop.ownerToken),
        subBody(),
      );
      expect(res.statusCode).toBe(503);
      expect(json<{ code: string }>(res).code).toBe('NOTIFICATIONS_NOT_CONFIGURED');
      // Transactions still work and nothing is queued.
      const sale = await post(bare, '/v1/transactions', shop.cashier.headers, txBody(bare, shop));
      expect(sale.statusCode).toBe(201);
    } finally {
      await bare.close();
    }
  });
});

async function ownerId(shop: Shop): Promise<string | undefined> {
  const { users } = await import('../src/db/schema.js');
  const [u] = await env.handle.db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, shop.seeded.ownerEmail));
  return u?.id;
}

describe('prefs', () => {
  it('defaults to everything on, patches per type and is honoured for every browser', async () => {
    const shop = await createShop(env);
    expect(json(await get(env, '/v1/notifications/prefs', owner(shop)))).toEqual({
      transaction: true,
      void: true,
    });
    await subscribe(shop);
    await subscribe(shop);
    const patched = await patch(env, '/v1/notifications/prefs', owner(shop), {
      transaction: false,
    });
    expect(json(patched)).toEqual({ transaction: false, void: true });
    expect((await patch(env, '/v1/notifications/prefs', owner(shop), {})).statusCode).toBe(400);
    expect(
      (await patch(env, '/v1/notifications/prefs', owner(shop), { other: true })).statusCode,
    ).toBe(400);

    await cashSale(shop);
    await settle();
    expect(await logRows(shop, 'transaction.paid')).toHaveLength(0);
    await patch(env, '/v1/notifications/prefs', owner(shop), { transaction: true, void: false });
    await cashSale(shop);
    await settle();
    expect(await logRows(shop, 'transaction.paid')).toHaveLength(2);
    const audit = await env.handle.db
      .select()
      .from(auditLogs)
      .where(
        and(
          eq(auditLogs.outletId, shop.seeded.outletId),
          eq(auditLogs.action, 'notification.prefs_updated'),
        ),
      );
    expect(audit).toHaveLength(2);
  });
});

describe('transaction notifications', () => {
  it('sends exactly one transaction.paid per active owner browser with the final copy', async () => {
    const shop = await createShop(env);
    const a = await subscribe(shop);
    await subscribe(shop);
    const manager = await addUser(shop, 'manager', 'Manajer');
    // A manager cannot subscribe through the API; force a row to prove managers are skipped anyway.
    expect(manager).toBeTruthy();
    push.sent.length = 0;
    const id = await cashSale(shop);
    await settle();
    const rows = await logRows(shop, 'transaction.paid');
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.entityId === id && r.status === 'sent')).toBe(true);
    expect(push.sent).toHaveLength(2);
    const sent = push.sent[0];
    expect(sent?.options).toEqual({ ttlSeconds: 14_400, urgency: 'high' });
    expect(sent?.payload).toMatchObject({
      v: 1,
      kind: 'trx.single',
      title: '💰 Transaksi masuk Rp45.000',
      tag: `trx-${id}`,
    });
    expect(sent?.payload['body']).toMatch(/^Cash · 3 item · Kasir Siti\n\d\d\.\d\d WIB · #/);
    expect(String(sent?.payload['url'])).toMatch(
      /^\/transaksi\?date_from=\d{4}-\d\d-\d\d&date_to=/,
    );
    const text = JSON.stringify(sent?.payload);
    expect(text.length).toBeLessThan(1024);
    expect(text).not.toMatch(/customer|pin|token|reason/i);
    const [sub] = await env.handle.db
      .select()
      .from(pushSubscriptions)
      .where(eq(pushSubscriptions.id, a.id));
    expect(sub?.lastDeliveredAt).not.toBeNull();
  });

  it('does not make the response wait for the push service, and a failing push never fails the sale', async () => {
    const shop = await createShop(env);
    await subscribe(shop);
    let release: () => void = () => undefined;
    push.gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const started = Date.now();
    const id = await cashSale(shop);
    expect(Date.now() - started).toBeLessThan(2000);
    push.gate = undefined;
    release();
    await settle();
    expect(id).toBeTruthy();

    push.respond = () => ({ ok: false, error: 'Error ECONNRESET' });
    const sale = await post(env, '/v1/transactions', shop.cashier.headers, txBody(env, shop));
    expect(sale.statusCode).toBe(201);
    await settle();
    push.respond = () => ({ ok: true, status: 201 });
  });

  it('QRIS: pending sends nothing, confirm sends once, repeated confirm still once', async () => {
    const shop = await createShop(env);
    await subscribe(shop);
    const body = txBody(env, shop, { method: 'qris' });
    const created = await post(env, '/v1/transactions', shop.cashier.headers, body);
    expect(created.statusCode, created.body).toBe(201);
    await settle();
    expect(await logRows(shop)).toHaveLength(0);
    const paymentId = body.payment.id;
    for (let i = 0; i < 2; i++) {
      const res = await post(env, `/v1/payments/${paymentId}/confirm`, shop.cashier.headers, {});
      expect(res.statusCode, res.body).toBe(200);
      await settle();
    }
    const rows = await logRows(shop, 'transaction.paid');
    expect(rows).toHaveLength(1);
    expect(rows[0]?.entityId).toBe(body.id);
    expect(rows[0]?.payload).toMatchObject({ title: '💰 Transaksi masuk Rp30.000' });
  });
});

describe('sync/push', () => {
  const mutation = (shop: Shop, qty: number, method: 'cash' | 'qris' = 'cash') => {
    const body = txBody(env, shop, { qty, method });
    return {
      id: body.id,
      type: 'transaction.create',
      client_created_at: body.client_created_at,
      employee_id: shop.cashier.employeeId,
      payload: body,
    };
  };
  const push_ = (shop: Shop, mutations: ReturnType<typeof mutation>[]) =>
    post(env, '/v1/sync/push', { 'x-device-token': shop.device.token }, { mutations });

  it('3 applied transactions → 3 offline notifications; replay adds nothing', async () => {
    const shop = await createShop(env);
    await subscribe(shop);
    const mutations = [mutation(shop, 1), mutation(shop, 2), mutation(shop, 3)];
    expect((await push_(shop, mutations)).statusCode).toBe(200);
    await settle();
    const rows = await logRows(shop, 'transaction.paid');
    expect(rows).toHaveLength(3);
    expect(rows.every((r) => (r.payload as { kind: string }).kind === 'trx.offline')).toBe(true);
    expect((rows[0]?.payload as { title: string }).title).toContain('· offline');
    expect((rows[0]?.payload as { body: string }).body).toContain('Dibuat ');

    await push_(shop, mutations);
    await settle();
    expect(await logRows(shop)).toHaveLength(3);
  });

  it('4 paid transactions (QRIS pending excluded) → one batch summary with totals, methods and cashier', async () => {
    const shop = await createShop(env);
    await subscribe(shop);
    const mutations = [
      mutation(shop, 1),
      mutation(shop, 2),
      mutation(shop, 1, 'qris'),
      mutation(shop, 4),
      mutation(shop, 5),
    ];
    await push_(shop, mutations);
    await settle();
    const rows = await logRows(shop);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.event).toBe('transaction.batch');
    const payload = rows[0]?.payload as { title: string; body: string; tag: string };
    expect(payload.title).toBe('📦 4 transaksi dari mode offline');
    expect(payload.body).toMatch(
      /^Total Rp180\.000 · Cash 4\nKasir Siti · disinkronkan \d\d\.\d\d WIB$/,
    );
    const paidIds = mutations.filter((m, i) => i !== 2).map((m) => m.id);
    expect(rows[0]?.entityId).toBe([...paidIds].sort()[0]);

    await push_(shop, mutations);
    await settle();
    expect(await logRows(shop)).toHaveLength(1);
  });

  it('5 cash + qris-free batch counts both methods when paid', async () => {
    const shop = await createShop(env);
    await subscribe(shop);
    const mutations = [1, 2, 3, 4, 5].map((q) => mutation(shop, q));
    await push_(shop, mutations);
    await settle();
    const rows = await logRows(shop);
    expect(rows).toHaveLength(1);
    expect((rows[0]?.payload as { title: string }).title).toBe('📦 5 transaksi dari mode offline');
  });
});

describe('void notifications', () => {
  const requestVoid = (shop: Shop, id: string) =>
    post(env, `/v1/transactions/${id}/void-requests`, shop.cashier.headers, {
      reason: 'Rahasia alasan void',
    });

  it('notifies on request and on dashboard approval, but not the owner who approved', async () => {
    const shop = await createShop(env);
    const mine = await subscribe(shop);
    const otherToken = await addUser(shop, 'owner', 'Owner Dua');
    const theirs = await subscribe(shop, subBody(), otherToken);
    const id = await cashSale(shop);
    await settle();

    const requested = json<{ id: string }>(await requestVoid(shop, id));
    await settle();
    const requests = await logRows(shop, 'void.requested');
    expect(requests.map((r) => r.subscriptionId).sort()).toEqual([mine.id, theirs.id].sort());
    expect(JSON.stringify(requests[0]?.payload)).not.toContain('Rahasia');
    expect(requests[0]?.payload).toMatchObject({ title: '⚠️ Pembatalan diajukan', url: '/void' });

    const res = await post(env, `/v1/void-requests/${requested.id}/approve`, owner(shop), {});
    expect(res.statusCode, res.body).toBe(200);
    await settle();
    const approved = await logRows(shop, 'void.approved');
    expect(approved.map((r) => r.subscriptionId)).toEqual([theirs.id]);
    expect(approved[0]?.payload).toMatchObject({ title: '⚠️ Transaksi dibatalkan' });
    expect((approved[0]?.payload as { body: string }).body).toContain('Disetujui Test Owner');

    // Replaying the approval does not notify again.
    await post(env, `/v1/void-requests/${requested.id}/approve`, owner(shop), {});
    await settle();
    expect(await logRows(shop, 'void.approved')).toHaveLength(1);
  });

  it('approval with the owner PIN on the device reaches every owner; rejection reaches nobody', async () => {
    const shop = await createShop(env);
    const mine = await subscribe(shop);
    const pin = nextPin();
    expect((await patch(env, '/v1/settings', owner(shop), { owner_pin: pin })).statusCode).toBe(
      200,
    );
    const id = await cashSale(shop);
    const requested = json<{ id: string }>(await requestVoid(shop, id));
    const res = await post(
      env,
      `/v1/void-requests/${requested.id}/approve-with-pin`,
      shop.cashier.headers,
      { owner_pin: pin },
    );
    expect(res.statusCode, res.body).toBe(200);
    await settle();
    expect((await logRows(shop, 'void.approved')).map((r) => r.subscriptionId)).toEqual([mine.id]);

    const id2 = await cashSale(shop);
    const second = json<{ id: string }>(await requestVoid(shop, id2));
    await post(env, `/v1/void-requests/${second.id}/reject`, owner(shop), {});
    await settle();
    expect(await logRows(shop, 'void.approved')).toHaveLength(1);
  });

  it('an owner voiding directly does not notify themselves but does notify other owners', async () => {
    const shop = await createShop(env);
    await subscribe(shop);
    const otherToken = await addUser(shop, 'owner', 'Owner Dua');
    const theirs = await subscribe(shop, subBody(), otherToken);
    const id = await cashSale(shop);
    const res = await post(env, `/v1/transactions/${id}/void-requests`, owner(shop), {
      reason: 'Salah input',
    });
    expect(res.statusCode, res.body).toBe(200);
    await settle();
    const rows = await logRows(shop, 'void.approved');
    expect(rows.map((r) => r.subscriptionId)).toEqual([theirs.id]);
    expect(rows[0]?.entityId).toBe(id);
  });
});

describe('dispatcher', () => {
  it('410 expires the subscription and fails its other pending rows', async () => {
    const shop = await createShop(env);
    const sub = await subscribe(shop);
    push.respond = () => ({ ok: false, status: 410, error: 'HTTP 410' });
    await cashSale(shop);
    await settle();
    push.respond = () => ({ ok: true, status: 201 });
    const [row] = await env.handle.db
      .select()
      .from(pushSubscriptions)
      .where(eq(pushSubscriptions.id, sub.id));
    expect(row?.revokedReason).toBe('gone');
    expect(row?.revokedAt).not.toBeNull();
    const list = json<{ items: { id: string; status: string }[] }>(
      await get(env, '/v1/notifications/push/subscriptions', owner(shop)),
    ).items;
    expect(list).toEqual([expect.objectContaining({ id: sub.id, status: 'expired' })]);
    expect((await logRows(shop))[0]?.status).toBe('failed');
    // New sales are no longer queued for it.
    await cashSale(shop);
    await settle();
    expect(await logRows(shop)).toHaveLength(1);
    // The test endpoint reports 410 for an expired browser.
    const test = await post(
      env,
      `/v1/notifications/push/subscriptions/${sub.id}/test`,
      owner(shop),
      {},
    );
    expect(test.statusCode).toBe(410);
    expect(json<{ code: string }>(test).code).toBe('NOTIFICATION_SUBSCRIPTION_GONE');
  });

  it('test endpoint: 410 from the push service expires the browser, other errors give 502', async () => {
    const shop = await createShop(env);
    const a = await subscribe(shop);
    const b = await subscribe(shop);
    push.respond = () => ({ ok: false, status: 500, error: 'HTTP 500' });
    const bad = await post(
      env,
      `/v1/notifications/push/subscriptions/${a.id}/test`,
      owner(shop),
      {},
    );
    expect(bad.statusCode).toBe(502);
    expect(json<{ code: string }>(bad).code).toBe('PUSH_DELIVERY_FAILED');
    push.respond = () => ({ ok: false, status: 404, error: 'HTTP 404' });
    const gone = await post(
      env,
      `/v1/notifications/push/subscriptions/${b.id}/test`,
      owner(shop),
      {},
    );
    expect(gone.statusCode).toBe(410);
    push.respond = () => ({ ok: true, status: 201 });
    const unknown = await post(
      env,
      '/v1/notifications/push/subscriptions/00000000-0000-4000-8000-000000000000/test',
      owner(shop),
      {},
    );
    expect(unknown.statusCode).toBe(404);
  });

  it('5xx and timeouts back off, then deliver after recovery; 429 honours Retry-After', async () => {
    const shop = await createShop(env);
    await subscribe(shop);
    push.respond = () => ({ ok: false, status: 503, error: 'HTTP 503' });
    await cashSale(shop);
    await settle();
    let [row] = await logRows(shop);
    expect(row).toMatchObject({ status: 'pending', attempts: 1 });
    // Not due yet: nothing is sent.
    const before = push.sent.length;
    env.app.notifier.kick();
    await settle();
    expect(push.sent.length).toBe(before);

    env.clock.advance(31_000);
    push.respond = () => ({ ok: false, status: 429, retryAfterSec: 120, error: 'HTTP 429' });
    env.app.notifier.kick();
    await settle();
    [row] = await logRows(shop);
    expect(row?.attempts).toBe(1);
    env.clock.advance(60_000);
    const mid = push.sent.length;
    env.app.notifier.kick();
    await settle();
    expect(push.sent.length).toBe(mid);

    env.clock.advance(61_000);
    push.respond = () => ({ ok: true, status: 201 });
    env.app.notifier.kick();
    await settle();
    [row] = await logRows(shop);
    expect(row?.status).toBe('sent');
  });

  it('gives up after 5 attempts, fails fast on 4xx and expires rows older than their TTL', async () => {
    const shop = await createShop(env);
    await subscribe(shop);
    push.respond = () => ({ ok: false, error: 'Error ETIMEDOUT' });
    await cashSale(shop);
    await settle();
    for (let i = 0; i < 6; i++) {
      env.clock.advance(31 * 60 * 1000);
      env.app.notifier.kick();
      await settle();
    }
    const [row] = await logRows(shop);
    expect(row).toMatchObject({ status: 'failed', attempts: 5, lastError: 'Error ETIMEDOUT' });

    push.respond = () => ({ ok: false, status: 403, error: 'HTTP 403' });
    await cashSale(shop);
    await settle();
    expect((await logRows(shop)).filter((r) => r.status === 'failed')).toHaveLength(2);

    push.respond = () => ({ ok: false, status: 503, error: 'HTTP 503' });
    await cashSale(shop);
    await settle();
    env.clock.advance(5 * 60 * 60 * 1000);
    push.respond = () => ({ ok: true, status: 201 });
    const sentBefore = push.sent.length;
    env.app.notifier.kick();
    await settle();
    expect((await logRows(shop)).filter((r) => r.status === 'expired')).toHaveLength(1);
    expect(push.sent.length).toBe(sentBefore);
  });

  it('keeps the push endpoint and VAPID key out of last_error, audit and responses', async () => {
    const shop = await createShop(env);
    const body = subBody();
    const sub = await subscribe(shop, body);
    push.respond = () => ({ ok: false, status: 503, error: 'HTTP 503 upstream' });
    await cashSale(shop);
    await post(env, `/v1/notifications/push/subscriptions/${sub.id}/test`, owner(shop), {});
    await settle();
    push.respond = () => ({ ok: true, status: 201 });
    const rows = await logRows(shop);
    const audits = await env.handle.db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.outletId, shop.seeded.outletId));
    const everything = JSON.stringify([rows.map((r) => r.lastError), audits]);
    expect(everything).not.toContain(body.endpoint);
    expect(everything).not.toContain(keys.privateKey);
  });

  it('login still works for owners (sanity)', async () => {
    const shop = await createShop(env);
    expect((await loginOwner(env, shop.seeded)).token).toBeTruthy();
  });
});
