import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  bearer,
  createShop,
  createTestEnv,
  get,
  json,
  post,
  txBody,
  type Shop,
  type TestEnv,
} from './helpers.js';

/** ADR-0011: an idle API must leave Neon asleep, so repeated polls may not reach the database. */
let env: TestEnv;
let acquired = 0;
beforeAll(async () => {
  env = await createTestEnv();
  env.handle.pool.on('acquire', () => {
    acquired += 1;
  });
});
afterAll(async () => {
  await env.close();
});

const headers = (shop: Shop) => ({ 'x-device-token': shop.device.token });
const pull = async (shop: Shop, cursor?: string) => {
  const res = await get(env, `/v1/sync/pull${cursor ? `?cursor=${cursor}` : ''}`, headers(shop));
  expect(res.statusCode, res.body).toBe(200);
  return json<{ next_cursor: string; changes: { products: { name: string }[] } }>(res);
};

/** Pull until the cursor is caught up and the answer is cached. */
async function settle(shop: Shop): Promise<string> {
  let cursor = (await pull(shop)).next_cursor;
  cursor = (await pull(shop, cursor)).next_cursor;
  await pull(shop, cursor);
  return cursor;
}

describe('idle API does not query the database', () => {
  it('serves repeated sync/pull polls with the same cursor and device checks from memory', async () => {
    const shop = await createShop(env);
    const cursor = await settle(shop);
    env.clock.advance(3 * 60_000); // the last write is no longer recent: the database may sleep

    const before = acquired;
    for (let i = 0; i < 20; i += 1) {
      env.clock.advance(30_000); // 10 minutes of 30 second polling
      const res = await pull(shop, cursor);
      expect(res.next_cursor).toBe(cursor);
      expect(res.changes.products).toEqual([]);
    }
    expect(acquired - before).toBe(0);
  });

  it('a catalog write is delivered by the next poll and the cache then catches up again', async () => {
    const shop = await createShop(env);
    const cursor = await settle(shop);

    const created = await post(env, '/v1/products', bearer(shop.ownerToken), {
      category_id: shop.category.id,
      name: 'Jus Mangga',
      price: 12_000,
    });
    expect(created.statusCode).toBe(201);

    const delivered = await pull(shop, cursor);
    expect(delivered.changes.products.map((p) => p.name)).toEqual(['Jus Mangga']);
    await pull(shop, delivered.next_cursor);
    const before = acquired;
    await pull(shop, delivered.next_cursor);
    expect(acquired - before).toBe(0);
  });

  it('a transaction invalidates the cached answer (shift totals, last number)', async () => {
    const shop = await createShop(env);
    const cursor = await settle(shop);
    const before = (await get(env, `/v1/sync/pull?cursor=${cursor}`, headers(shop))).json() as {
      last_number: string | null;
    };
    expect(before.last_number).toBeNull();

    const body = txBody(env, shop, { method: 'cash' });
    expect((await post(env, '/v1/transactions', shop.cashier.headers, body)).statusCode).toBe(201);

    const after = (await get(env, `/v1/sync/pull?cursor=${cursor}`, headers(shop))).json() as {
      last_number: string | null;
    };
    expect(after.last_number).toBe(body.number);
  });

  it('revoking a device is effective at once even though its token was cached', async () => {
    const shop = await createShop(env);
    const cursor = await settle(shop);
    expect((await get(env, `/v1/sync/pull?cursor=${cursor}`, headers(shop))).statusCode).toBe(200);

    const revoked = await post(
      env,
      `/v1/devices/${shop.device.id}/revoke`,
      bearer(shop.ownerToken),
      {},
    );
    expect(revoked.statusCode).toBe(200);

    const res = await get(env, `/v1/sync/pull?cursor=${cursor}`, headers(shop));
    expect(res.statusCode).toBe(401);
    expect(json<{ code?: string }>(res)).toMatchObject({ code: 'DEVICE_REVOKED' });
  });
});
