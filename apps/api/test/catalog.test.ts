import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { auditLogs } from '../src/db/schema.js';
import {
  bearer,
  createShop,
  createTestEnv,
  get,
  json,
  patch,
  post,
  seedOutlet,
  loginOwner,
  type Shop,
  type TestEnv,
} from './helpers.js';

let env: TestEnv;
beforeAll(async () => {
  env = await createTestEnv();
});
afterAll(async () => {
  await env.close();
});

interface ProductDto {
  id: string;
  category_id: string;
  name: string;
  price: number;
  is_active: boolean;
  is_sold_out: boolean;
  is_favorite: boolean;
  sort_order: number;
  image_url: string | null;
}

const auditActions = async (shop: Shop, entityId: string) =>
  (
    await env.handle.db
      .select({ action: auditLogs.action, before: auditLogs.before, after: auditLogs.after })
      .from(auditLogs)
      .where(and(eq(auditLogs.outletId, shop.seeded.outletId), eq(auditLogs.entityId, entityId)))
  ).sort((a, b) => a.action.localeCompare(b.action));

describe('categories', () => {
  it('creates, lists in order, renames and soft-deletes', async () => {
    const shop = await createShop(env);
    const owner = bearer(shop.ownerToken);
    const b = json<{ id: string }>(
      await post(env, '/v1/categories', owner, { name: 'Smoothie', sort_order: 20 }),
    );
    await post(env, '/v1/categories', owner, { name: 'Es Kelapa', sort_order: 5 });

    const list = json<{ data: { name: string; sort_order: number }[] }>(
      await get(env, '/v1/categories', owner),
    );
    expect(list.data.map((c) => c.name)).toEqual(['Jus Buah', 'Es Kelapa', 'Smoothie']);

    const renamed = await patch(env, `/v1/categories/${b.id}`, owner, { name: 'Smoothies' });
    expect(renamed.statusCode).toBe(200);
    expect(json(renamed)).toMatchObject({ id: b.id, name: 'Smoothies', sort_order: 20 });

    const del = await env.app.inject({
      method: 'DELETE',
      url: `/v1/categories/${b.id}`,
      headers: owner,
    });
    expect(del.statusCode).toBe(204);
    const after = json<{ data: { id: string }[] }>(await get(env, '/v1/categories', owner));
    expect(after.data.map((c) => c.id)).not.toContain(b.id);
    expect((await auditActions(shop, b.id)).map((a) => a.action)).toEqual([
      'category.created',
      'category.deleted',
      'category.updated',
    ]);
  });

  it('refuses to delete a category that still has products', async () => {
    const shop = await createShop(env);
    const res = await env.app.inject({
      method: 'DELETE',
      url: `/v1/categories/${shop.category.id}`,
      headers: bearer(shop.ownerToken),
    });
    expect(res.statusCode).toBe(409);
    expect(json(res)).toMatchObject({ code: 'CATEGORY_NOT_EMPTY' });
  });

  it('validates input and is scoped to the outlet', async () => {
    const shop = await createShop(env);
    const other = await createShop(env);
    const owner = bearer(shop.ownerToken);
    expect((await post(env, '/v1/categories', owner, { name: '' })).statusCode).toBe(400);
    expect((await post(env, '/v1/categories', owner, { name: 'x'.repeat(41) })).statusCode).toBe(
      400,
    );
    expect((await patch(env, `/v1/categories/${shop.category.id}`, owner, {})).statusCode).toBe(
      400,
    );
    const foreign = await patch(env, `/v1/categories/${other.category.id}`, owner, {
      name: 'Hack',
    });
    expect(foreign.statusCode).toBe(404);
  });
});

describe('products', () => {
  it('creates a single-price product with favorite flag and sort order', async () => {
    const shop = await createShop(env);
    const res = await post(env, '/v1/products', bearer(shop.ownerToken), {
      category_id: shop.category.id,
      name: 'Jus Mangga',
      price: 12_500,
      is_favorite: true,
      sort_order: 3,
    });
    expect(res.statusCode).toBe(201);
    expect(json<ProductDto>(res)).toMatchObject({
      name: 'Jus Mangga',
      price: 12_500,
      is_active: true,
      is_sold_out: false,
      is_favorite: true,
      sort_order: 3,
      image_url: null,
    });
  });

  it('rejects bad prices, unknown categories and variant-like extras are ignored', async () => {
    const shop = await createShop(env);
    const owner = bearer(shop.ownerToken);
    const base = { category_id: shop.category.id, name: 'X', price: 1000 };
    expect((await post(env, '/v1/products', owner, { ...base, price: -1 })).statusCode).toBe(400);
    expect((await post(env, '/v1/products', owner, { ...base, price: 10.5 })).statusCode).toBe(400);
    expect((await post(env, '/v1/products', owner, { ...base, name: ' ' })).statusCode).toBe(400);
    const unknown = await post(env, '/v1/products', owner, {
      ...base,
      category_id: '019a0000-0000-7000-8000-000000000000',
    });
    expect(unknown.statusCode).toBe(400);
    expect(json(unknown)).toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('cannot use a category of another outlet', async () => {
    const shop = await createShop(env);
    const other = await createShop(env);
    const res = await post(env, '/v1/products', bearer(shop.ownerToken), {
      category_id: other.category.id,
      name: 'Curang',
      price: 1000,
    });
    expect(res.statusCode).toBe(400);
  });

  it('filters the list by category, activity and name', async () => {
    const shop = await createShop(env);
    const owner = bearer(shop.ownerToken);
    const cat2 = json<{ id: string }>(await post(env, '/v1/categories', owner, { name: 'Lain' }));
    const mk = (name: string, category_id: string, extra = {}) =>
      post(env, '/v1/products', owner, { category_id, name, price: 5000, ...extra });
    await mk('Jus Jeruk 100%', shop.category.id);
    await mk('Teh Manis', cat2.id, { is_active: false });
    await mk('Teh Tawar', cat2.id);

    const names = async (qs: string) =>
      json<{ data: { name: string }[] }>(await get(env, `/v1/products?${qs}`, owner)).data.map(
        (p) => p.name,
      );
    expect(await names(`category_id=${cat2.id}`)).toEqual(['Teh Manis', 'Teh Tawar']);
    expect(await names('is_active=false')).toEqual(['Teh Manis']);
    expect(await names('q=teh')).toEqual(['Teh Manis', 'Teh Tawar']);
    expect(await names('q=100%25')).toEqual(['Jus Jeruk 100%']); // LIKE wildcards are escaped
    expect(await names('q=%25')).toEqual(['Jus Jeruk 100%']);
    expect(await names('q=_')).toEqual([]);
  });

  it('writes a price change to the audit log with old and new price', async () => {
    const shop = await createShop(env);
    const res = await patch(env, `/v1/products/${shop.product.id}`, bearer(shop.ownerToken), {
      price: 18_000,
    });
    expect(res.statusCode).toBe(200);
    expect(json<ProductDto>(res).price).toBe(18_000);
    const trail = await auditActions(shop, shop.product.id);
    const price = trail.find((a) => a.action === 'product.price_changed');
    expect(price?.before).toEqual({ price: 15_000 });
    expect(price?.after).toEqual({ price: 18_000 });
    // Renaming without a price change does not produce a price entry.
    await patch(env, `/v1/products/${shop.product.id}`, bearer(shop.ownerToken), { name: 'Baru' });
    const again = await auditActions(shop, shop.product.id);
    expect(again.filter((a) => a.action === 'product.price_changed')).toHaveLength(1);
    expect(again.map((a) => a.action)).toContain('product.updated');
  });

  it('soft-deletes: gone from lists and the catalog, kept in the database', async () => {
    const shop = await createShop(env);
    const owner = bearer(shop.ownerToken);
    const del = await env.app.inject({
      method: 'DELETE',
      url: `/v1/products/${shop.product.id}`,
      headers: owner,
    });
    expect(del.statusCode).toBe(204);
    expect((await get(env, `/v1/products/${shop.product.id}`, owner)).statusCode).toBe(404);
    const list = json<{ data: unknown[] }>(await get(env, '/v1/products', owner));
    expect(list.data).toHaveLength(0);
    const catalog = json<{ products: unknown[] }>(
      await get(env, '/v1/catalog', { 'x-device-token': shop.device.token }),
    );
    expect(catalog.products).toHaveLength(0);
    expect((await auditActions(shop, shop.product.id)).map((a) => a.action)).toContain(
      'product.deleted',
    );
  });

  it('is reserved for the owner of the outlet', async () => {
    const shop = await createShop(env);
    const other = await createShop(env);
    const owner = bearer(other.ownerToken);
    expect((await get(env, `/v1/products/${shop.product.id}`, owner)).statusCode).toBe(404);
    expect((await get(env, '/v1/products', shop.cashier.headers)).statusCode).toBe(403);
    expect((await post(env, '/v1/products', {}, {})).statusCode).toBe(401);
  });

  it('only accepts image URLs under the configured storage location', async () => {
    const strict = await createTestEnv({
      storage: {
        endpoint: 'https://acct.r2.cloudflarestorage.com',
        bucket: 'media',
        accessKeyId: 'k',
        secretAccessKey: 's',
        region: 'auto',
        apiPublicBaseUrl: 'https://api.example',
        publicBaseUrl: 'https://media.example',
      },
    });
    try {
      const seeded = await seedOutlet(strict);
      const owner = await loginOwner(strict, seeded);
      const cat = json<{ id: string }>(
        await post(strict, '/v1/categories', bearer(owner.token), { name: 'C' }),
      );
      const body = { category_id: cat.id, name: 'P', price: 1000 };
      for (const image_url of [
        `https://api.example/v1/media/${seeded.outletId}/product_image/${randomUUID()}.png`,
        'https://media.example/o/p/a.png', // legacy public bucket URL stays valid
      ]) {
        const ok = await post(strict, '/v1/products', bearer(owner.token), { ...body, image_url });
        expect(ok.statusCode).toBe(201);
      }
      for (const image_url of [
        'https://evil.example/a.png',
        'https://evil.example/v1/media/x.png',
        'https://api.example.evil.example/v1/media/x.png',
        'javascript:alert(1)',
      ]) {
        const bad = await post(strict, '/v1/products', bearer(owner.token), { ...body, image_url });
        expect(bad.statusCode).toBe(400);
      }
    } finally {
      await strict.close();
    }
  });
});

describe('availability and catalog snapshot', () => {
  it('lets a cashier mark a product sold out and back, with an audit trail', async () => {
    const shop = await createShop(env);
    const url = `/v1/products/${shop.product.id}/availability`;
    const out = await patch(env, url, shop.cashier.headers, { is_sold_out: true });
    expect(out.statusCode).toBe(200);
    expect(json<ProductDto>(out).is_sold_out).toBe(true);
    // Idempotent: same value again changes nothing.
    expect((await patch(env, url, shop.cashier.headers, { is_sold_out: true })).statusCode).toBe(
      200,
    );
    const back = await patch(env, url, bearer(shop.ownerToken), { is_sold_out: false });
    expect(json<ProductDto>(back).is_sold_out).toBe(false);
    const trail = (await auditActions(shop, shop.product.id)).filter(
      (a) => a.action === 'product.availability_changed',
    );
    expect(trail).toHaveLength(2);
    expect((await patch(env, url, shop.cashier.headers, { is_sold_out: 'yes' })).statusCode).toBe(
      400,
    );
  });

  it('serves the catalog to a device or the owner, with a sync cursor', async () => {
    const shop = await createShop(env);
    const hidden = await post(env, '/v1/products', bearer(shop.ownerToken), {
      category_id: shop.category.id,
      name: 'Nonaktif',
      price: 1000,
      is_active: false,
    });
    expect(hidden.statusCode).toBe(201);

    for (const headers of [{ 'x-device-token': shop.device.token }, bearer(shop.ownerToken)]) {
      const res = await get(env, '/v1/catalog', headers);
      expect(res.statusCode).toBe(200);
      const body = json<{ categories: unknown[]; products: ProductDto[]; cursor: string }>(res);
      expect(body.categories).toHaveLength(1);
      expect(body.products.map((p) => p.name)).toEqual(['Jus Alpukat']); // inactive hidden
      expect(typeof body.cursor).toBe('string');
    }
    expect((await get(env, '/v1/catalog', {})).statusCode).toBe(401);
    // An employee bearer alone (without the device header) is not enough.
    expect(
      (
        await get(env, '/v1/catalog', {
          authorization: shop.cashier.headers['authorization'] ?? '',
        })
      ).statusCode,
    ).toBe(403);
  });

  it('does not leak another outlet', async () => {
    const shop = await createShop(env);
    const other = await createShop(env);
    const res = json<{ products: ProductDto[] }>(
      await get(env, '/v1/catalog', { 'x-device-token': other.device.token }),
    );
    expect(res.products.map((p) => p.id)).not.toContain(shop.product.id);
  });
});
