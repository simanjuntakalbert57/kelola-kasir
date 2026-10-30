import { and, eq } from 'drizzle-orm';
import ExcelJS from 'exceljs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { auditLogs, categories, products } from '../src/db/schema.js';
import {
  bearer,
  createEmployee,
  createShop,
  createTestEnv,
  get,
  json,
  post,
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

const HEADER = 'nama;kategori;harga;favorit;aktif';
const MiB = 1024 * 1024;

interface Preview {
  format: string;
  file_sha256: string;
  summary: { total: number; create: number; update: number; unchanged: number; error: number };
  new_categories: string[];
  rows: {
    row: number;
    action: string;
    product_id: string | null;
    category_is_new: boolean;
    changes: { field: string; before: unknown; after: unknown }[];
    errors: { column: string | null; code: string; message: string }[];
  }[];
  warnings: { code: string }[];
  import_token: string | null;
  expires_at: string | null;
}

function multipart(
  file: { name: string; data: Buffer } | null,
  fields: Record<string, string> = {},
) {
  const boundary = '----kktest1234567890';
  const chunks: Buffer[] = [];
  for (const [k, v] of Object.entries(fields)) {
    chunks.push(
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`),
    );
  }
  if (file) {
    chunks.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${file.name}"\r\nContent-Type: application/octet-stream\r\n\r\n`,
      ),
      file.data,
      Buffer.from('\r\n'),
    );
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`));
  return {
    payload: Buffer.concat(chunks),
    'content-type': `multipart/form-data; boundary=${boundary}`,
  };
}

const upload = (
  url: string,
  token: string,
  file: { name: string; data: Buffer } | null,
  fields: Record<string, string> = {},
) => {
  const { payload, 'content-type': contentType } = multipart(file, fields);
  return env.app.inject({
    method: 'POST',
    url,
    headers: { ...bearer(token), 'content-type': contentType },
    payload,
  });
};

const csv = (...lines: string[]) => ({
  name: 'produk.csv',
  data: Buffer.from([HEADER, ...lines].join('\r\n') + '\r\n'),
});

const preview = async (shop: Shop, file: { name: string; data: Buffer }) => {
  const res = await upload('/v1/products/import/preview', shop.ownerToken, file);
  expect(res.statusCode, res.body).toBe(200);
  return json<Preview>(res);
};
const commit = (shop: Shop, file: { name: string; data: Buffer }, token: string | null) =>
  upload('/v1/products/import/commit', shop.ownerToken, file, token ? { import_token: token } : {});

const productsOf = (shop: Shop) =>
  env.handle.db.select().from(products).where(eq(products.outletId, shop.seeded.outletId));
const categoriesOf = (shop: Shop) =>
  env.handle.db.select().from(categories).where(eq(categories.outletId, shop.seeded.outletId));
const auditOf = async (shop: Shop, action: string) =>
  (
    await env.handle.db
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.outletId, shop.seeded.outletId), eq(auditLogs.action, action)))
  ).map((r) => r);

/** createShop seeds category "Jus Buah" and product "Jus Alpukat" (Rp15.000). */
const mixedFile = () =>
  csv(
    'Jus Alpukat;Jus Buah;18.000;ya;',
    'Es Teh;Minuman;Rp5.000;;',
    'Kopi Susu;Minuman;"Rp 12.000,00";ya;tidak',
  );

describe('access control', () => {
  it('requires an owner token on all three endpoints', async () => {
    const shop = await createShop(env);
    const employee = await createEmployee(env, shop.ownerToken, 'Budi');
    expect(employee).toBeTruthy();
    for (const [method, url] of [
      ['GET', '/v1/products/import/template?format=csv'],
      ['POST', '/v1/products/import/preview'],
      ['POST', '/v1/products/import/commit'],
    ] as const) {
      expect((await env.app.inject({ method, url })).statusCode).toBe(401);
      const asCashier = await env.app.inject({ method, url, headers: shop.cashier.headers });
      expect(asCashier.statusCode, `${url} as employee`).toBe(403);
      const asDevice = await env.app.inject({
        method,
        url,
        headers: { 'x-device-token': shop.device.token },
      });
      expect([401, 403], `${url} as device`).toContain(asDevice.statusCode);
    }
  });
});

describe('GET /products/import/template', () => {
  it('serves the csv template with download headers', async () => {
    const shop = await createShop(env);
    const res = await get(env, '/v1/products/import/template?format=csv', bearer(shop.ownerToken));
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.headers['content-disposition']).toBe(
      'attachment; filename="template-impor-produk.csv"',
    );
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.rawPayload.subarray(0, 3)).toEqual(Buffer.from([0xef, 0xbb, 0xbf]));
  });

  it('serves an xlsx template that can be uploaded straight back', async () => {
    const shop = await createShop(env);
    const res = await get(env, '/v1/products/import/template?format=xlsx', bearer(shop.ownerToken));
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-disposition']).toContain('template-impor-produk.xlsx');
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(res.rawPayload as unknown as ExcelJS.Buffer);
    expect(wb.worksheets.map((s) => s.name)).toEqual(['Produk', 'Petunjuk']);
    const back = await preview(shop, { name: 'template-impor-produk.xlsx', data: res.rawPayload });
    expect(back.summary).toMatchObject({ total: 2, create: 1, update: 1, error: 0 });
    expect(back.import_token).toBeTruthy();
  });

  it('rejects an unknown format', async () => {
    const shop = await createShop(env);
    for (const q of ['', '?format=pdf']) {
      const res = await get(env, `/v1/products/import/template${q}`, bearer(shop.ownerToken));
      expect(res.statusCode).toBe(400);
    }
  });
});

describe('POST /products/import/preview', () => {
  it('reports create / update / unchanged without writing anything', async () => {
    const shop = await createShop(env);
    const before = await productsOf(shop);
    const catsBefore = await categoriesOf(shop);
    const res = await preview(shop, mixedFile());
    expect(res.summary).toEqual({ total: 3, create: 2, update: 1, unchanged: 0, error: 0 });
    expect(res.new_categories).toEqual(['Minuman']);
    expect(res.rows.map((r) => r.action)).toEqual(['update', 'create', 'create']);
    expect(res.rows[0]).toMatchObject({ row: 2, product_id: shop.product.id });
    expect(res.rows[0]?.changes).toEqual([
      { field: 'price', before: 15000, after: 18000 },
      { field: 'is_favorite', before: false, after: true },
    ]);
    expect(res.rows[1]?.category_is_new).toBe(true);
    expect(res.import_token).toMatch(/^v1\.\d+\.\d+\.[0-9a-f]{64}\./);
    expect(new Date(res.expires_at ?? '').getTime()).toBeGreaterThan(env.clock.now.getTime());
    expect(await productsOf(shop)).toEqual(before);
    expect(await categoriesOf(shop)).toEqual(catsBefore);
  });

  it('returns row errors with 200 and no token', async () => {
    const shop = await createShop(env);
    const res = await preview(
      shop,
      csv(
        'Es Teh;Minuman;15,5;;',
        ';Minuman;1000;;',
        'Teh;Minuman;1000;mungkin;',
        'Ok;Minuman;1000;;',
      ),
    );
    expect(res.summary).toMatchObject({ total: 4, create: 1, error: 3 });
    expect(res.import_token).toBeNull();
    expect(res.expires_at).toBeNull();
    expect(res.rows.flatMap((r) => r.errors.map((e) => e.code))).toEqual([
      'INVALID_PRICE',
      'REQUIRED',
      'INVALID_BOOLEAN',
    ]);
    expect(res.rows[0]?.errors[0]?.message).toContain('Harga harus angka bulat');
  });

  it('gives no token when everything is unchanged', async () => {
    const shop = await createShop(env);
    const res = await preview(shop, csv('jus alpukat;jus buah;15000;;'));
    expect(res.summary).toMatchObject({ unchanged: 1, create: 0, update: 0, error: 0 });
    expect(res.import_token).toBeNull();
  });

  it('ignores soft-deleted products (a new one is created)', async () => {
    const shop = await createShop(env);
    const del = await env.app.inject({
      method: 'DELETE',
      url: `/v1/products/${shop.product.id}`,
      headers: bearer(shop.ownerToken),
    });
    expect(del.statusCode).toBe(204);
    const res = await preview(shop, csv('Jus Alpukat;Jus Buah;15000;;'));
    expect(res.rows[0]).toMatchObject({ action: 'create', product_id: null });
  });

  it('flags duplicates in the file and ambiguous existing names', async () => {
    const shop = await createShop(env);
    await post(env, '/v1/products', bearer(shop.ownerToken), {
      category_id: shop.category.id,
      name: 'JUS ALPUKAT',
      price: 1000,
    });
    const res = await preview(
      shop,
      csv('Es Teh;K;1000;;', 'es teh;K;1000;;', 'Jus Alpukat;K;1000;;'),
    );
    expect(res.rows.map((r) => r.errors.map((e) => e.code))).toEqual([
      ['DUPLICATE_IN_FILE'],
      ['DUPLICATE_IN_FILE'],
      ['AMBIGUOUS_MATCH'],
    ]);
  });

  it('is limited to the caller outlet', async () => {
    const shop = await createShop(env);
    const other = await createShop(env);
    const res = await preview(other, csv('Jus Alpukat;Jus Buah;15000;;'));
    expect(res.rows[0]).toMatchObject({ action: 'unchanged', product_id: other.product.id });
    expect(other.product.id).not.toBe(shop.product.id);
  });

  it('answers file-level problems with the right status', async () => {
    const shop = await createShop(env);
    const run = (file: { name: string; data: Buffer } | null) =>
      upload('/v1/products/import/preview', shop.ownerToken, file);
    const bigName = 'x'.repeat(2 * MiB + 1);
    const tooLarge = await run({ name: 'a.csv', data: Buffer.from(`${HEADER}\n${bigName}`) });
    expect(tooLarge.statusCode).toBe(413);
    expect(json(tooLarge)).toMatchObject({ code: 'IMPORT_FILE_TOO_LARGE' });
    const unsupported = await run({ name: 'a.pdf', data: Buffer.from('x') });
    expect(unsupported.statusCode).toBe(415);
    const columns = await run({ name: 'a.csv', data: Buffer.from('nama;harga\nA;1\n') });
    expect(columns.statusCode).toBe(422);
    expect(json(columns)).toMatchObject({ code: 'IMPORT_COLUMNS_INVALID' });
    const rows = Array.from({ length: 501 }, (_, i) => `P${i};K;1;;`).join('\n');
    const many = await run({ name: 'a.csv', data: Buffer.from(`${HEADER}\n${rows}\n`) });
    expect(json(many)).toMatchObject({ code: 'IMPORT_TOO_MANY_ROWS' });
    expect(many.statusCode).toBe(422);
    const xls = await run({ name: 'a.xls', data: Buffer.from([0xd0, 0xcf, 0x11, 0xe0]) });
    expect(json(xls)).toMatchObject({ code: 'IMPORT_FILE_UNREADABLE' });
    expect((await run(null)).statusCode).toBe(400);
    const asJson = await post(env, '/v1/products/import/preview', bearer(shop.ownerToken), {});
    expect(asJson.statusCode).toBe(415);
  });

  it('accepts a file of exactly 2 MiB', async () => {
    const shop = await createShop(env);
    const head = Buffer.from(`${HEADER}\r\nA;K;1;;\r\n`);
    const pad = Buffer.alloc(2 * MiB - head.length, 0x20);
    const res = await upload('/v1/products/import/preview', shop.ownerToken, {
      name: 'a.csv',
      data: Buffer.concat([head, pad]),
    });
    expect(res.statusCode, res.body).toBe(200);
  });
});

describe('POST /products/import/commit', () => {
  it('saves everything in one go, audited, and reaches the cashier via /sync/pull', async () => {
    const shop = await createShop(env);
    const pull0 = json<{ next_cursor: string }>(
      await get(env, '/v1/sync/pull', { 'x-device-token': shop.device.token }),
    );
    // Properties the import must never touch.
    await env.app.inject({
      method: 'PATCH',
      url: `/v1/products/${shop.product.id}/availability`,
      headers: bearer(shop.ownerToken),
      payload: { is_sold_out: true },
    });
    await env.handle.db
      .update(products)
      .set({ sortOrder: 7, imageUrl: null })
      .where(eq(products.id, shop.product.id));
    const catsBefore = await categoriesOf(shop);

    const file = mixedFile();
    const pv = await preview(shop, file);
    const res = await commit(shop, file, pv.import_token);
    expect(res.statusCode, res.body).toBe(200);
    expect(json(res)).toEqual({ created: 2, updated: 1, unchanged: 0, categories_created: 1 });

    const rows = await productsOf(shop);
    expect(rows).toHaveLength(3);
    const alpukat = rows.find((p) => p.id === shop.product.id);
    expect(alpukat).toMatchObject({
      price: 18000,
      isFavorite: true,
      isActive: true,
      isSoldOut: true,
      sortOrder: 7,
      name: 'Jus Alpukat',
    });
    const cats = await categoriesOf(shop);
    expect(cats).toHaveLength(catsBefore.length + 1);
    const minuman = cats.find((c) => c.name === 'Minuman');
    expect(minuman?.sortOrder).toBe(0);
    const kopi = rows.find((p) => p.name === 'Kopi Susu');
    expect(kopi).toMatchObject({
      price: 12000,
      isFavorite: true,
      isActive: false,
      categoryId: minuman?.id,
      sortOrder: 0,
    });
    expect(rows.find((p) => p.name === 'Es Teh')).toMatchObject({
      price: 5000,
      isFavorite: false,
      isActive: true,
      categoryId: minuman?.id,
    });

    const imported = await auditOf(shop, 'product.imported');
    expect(imported).toHaveLength(1);
    expect(imported[0]).toMatchObject({
      entityType: 'product_import',
      actorId: expect.any(String),
      meta: {
        file_sha256: pv.file_sha256,
        format: 'csv',
        rows: 3,
        created: 2,
        updated: 1,
        unchanged: 0,
        categories_created: 1,
      },
    });
    expect(JSON.stringify(imported[0])).not.toContain('produk.csv');
    const prices = await auditOf(shop, 'product.price_changed');
    expect(prices).toHaveLength(1);
    expect(prices[0]).toMatchObject({
      entityId: shop.product.id,
      before: { price: 15000 },
      after: { price: 18000 },
    });

    const pulled = json<{
      changes: { products: { id: string; name: string }[]; categories: { name: string }[] };
    }>(
      await get(env, `/v1/sync/pull?cursor=${pull0.next_cursor}`, {
        'x-device-token': shop.device.token,
      }),
    );
    expect(pulled.changes.products.map((p) => p.name).sort()).toEqual([
      'Es Teh',
      'Jus Alpukat',
      'Kopi Susu',
    ]);
    expect(pulled.changes.categories.map((c) => c.name)).toContain('Minuman');
  });

  it('does not duplicate products when the same file is imported again', async () => {
    const shop = await createShop(env);
    const file = mixedFile();
    const pv = await preview(shop, file);
    expect((await commit(shop, file, pv.import_token)).statusCode).toBe(200);
    const again = await commit(shop, file, pv.import_token);
    expect(again.statusCode).toBe(409);
    expect(json(again)).toMatchObject({ code: 'IMPORT_STALE' });
    const second = await preview(shop, file);
    expect(second.summary).toMatchObject({ unchanged: 3, create: 0, update: 0, error: 0 });
    expect(second.import_token).toBeNull();
    expect(await productsOf(shop)).toHaveLength(3);
    expect(await categoriesOf(shop)).toHaveLength(2);
  });

  it('writes nothing when a row has an error', async () => {
    const shop = await createShop(env);
    const good = csv('Es Teh;Minuman;5000;;');
    const token = (await preview(shop, good)).import_token;
    const bad = csv('Es Teh;Minuman;5000;;', 'Kopi;Minuman;gratis;;');
    for (const t of [token, 'v1.1.1.x.y']) {
      const res = await commit(shop, bad, t);
      expect(res.statusCode).toBe(422);
      expect(json(res)).toMatchObject({ code: 'IMPORT_HAS_ERRORS' });
    }
    expect(await productsOf(shop)).toHaveLength(1);
    expect(await categoriesOf(shop)).toHaveLength(1);
    expect(await auditOf(shop, 'product.imported')).toHaveLength(0);
  });

  it('rejects a token for another file, a mangled token and a missing token', async () => {
    const shop = await createShop(env);
    const a = csv('Es Teh;Minuman;5000;;');
    const b = csv('Es Teh;Minuman;6000;;');
    const token = (await preview(shop, a)).import_token ?? '';
    const other = await commit(shop, b, token);
    expect(other.statusCode).toBe(400);
    expect(json(other)).toMatchObject({ code: 'IMPORT_TOKEN_INVALID' });
    for (const bad of ['garbage', `${token.slice(0, -2)}xx`, `${token}.extra`]) {
      const res = await commit(shop, a, bad);
      expect(res.statusCode, bad).toBe(400);
      expect(json(res)).toMatchObject({ code: 'IMPORT_TOKEN_INVALID' });
    }
    const missing = await commit(shop, a, null);
    expect(missing.statusCode).toBe(400);
    expect(json(missing)).toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(await productsOf(shop)).toHaveLength(1);
  });

  it('rejects a token issued to another owner or outlet', async () => {
    const shop = await createShop(env);
    const other = await createShop(env);
    const file = csv('Es Teh;Minuman;5000;;');
    const token = (await preview(shop, file)).import_token;
    const res = await commit(other, file, token);
    expect(res.statusCode).toBe(400);
    expect(json(res)).toMatchObject({ code: 'IMPORT_TOKEN_INVALID' });
  });

  it('answers IMPORT_STALE when the token expired', async () => {
    const shop = await createShop(env);
    const file = csv('Es Teh;Minuman;5000;;');
    const token = (await preview(shop, file)).import_token;
    env.clock.advance(31 * 60 * 1000);
    const res = await commit(shop, file, token);
    expect(res.statusCode).toBe(409);
    expect(json(res)).toMatchObject({ code: 'IMPORT_STALE' });
    expect(await productsOf(shop)).toHaveLength(1);
  });

  it('answers IMPORT_STALE when the catalog changed after the preview', async () => {
    const shop = await createShop(env);
    const file = csv('Es Teh;Minuman;5000;;');
    const token = (await preview(shop, file)).import_token;
    const edit = await env.app.inject({
      method: 'PATCH',
      url: `/v1/products/${shop.product.id}`,
      headers: bearer(shop.ownerToken),
      payload: { price: 1 },
    });
    expect(edit.statusCode).toBe(200);
    const res = await commit(shop, file, token);
    expect(res.statusCode).toBe(409);
    expect(json(res)).toMatchObject({ code: 'IMPORT_STALE' });
    expect(await productsOf(shop)).toHaveLength(1);
    // A fresh preview works again.
    const fresh = await preview(shop, file);
    expect((await commit(shop, file, fresh.import_token)).statusCode).toBe(200);
  });

  it('changes in another outlet do not make the token stale', async () => {
    const shop = await createShop(env);
    const file = csv('Es Teh;Minuman;5000;;');
    const token = (await preview(shop, file)).import_token;
    await createShop(env);
    expect((await commit(shop, file, token)).statusCode).toBe(200);
  });

  it('lets only one of two concurrent commits through', async () => {
    const shop = await createShop(env);
    const file = csv('Es Teh;Minuman;5000;;', 'Kopi;Kopi;7000;;');
    const token = (await preview(shop, file)).import_token;
    const results = await Promise.all([commit(shop, file, token), commit(shop, file, token)]);
    expect(results.map((r) => r.statusCode).sort()).toEqual([200, 409]);
    expect(await productsOf(shop)).toHaveLength(3);
    expect(await categoriesOf(shop)).toHaveLength(3);
  });

  it('imports an xlsx file the same way', async () => {
    const shop = await createShop(env);
    const wb = new ExcelJS.Workbook();
    const sheet = wb.addWorksheet('Produk');
    sheet.addRow(['Nama', 'Kategori', 'Harga (Rp)', 'Favorit', 'Aktif']);
    sheet.addRow(['Roti Bakar', 'Makanan', 12000, 'ya', true]);
    sheet.addRow(['Jus Alpukat', 'jus buah', 'Rp17.000', '', '']);
    const file = { name: 'produk.xlsx', data: Buffer.from(await wb.xlsx.writeBuffer()) };
    const pv = await preview(shop, file);
    expect(pv.format).toBe('xlsx');
    expect(pv.summary).toMatchObject({ create: 1, update: 1, error: 0 });
    const res = await commit(shop, file, pv.import_token);
    expect(res.statusCode, res.body).toBe(200);
    const rows = await productsOf(shop);
    expect(rows.find((p) => p.name === 'Roti Bakar')).toMatchObject({
      price: 12000,
      isFavorite: true,
    });
    expect(rows.find((p) => p.name === 'Jus Alpukat')?.price).toBe(17000);
    const meta = (await auditOf(shop, 'product.imported'))[0]?.meta;
    expect(meta).toMatchObject({ format: 'xlsx' });
  });

  it('commits 500 rows quickly', async () => {
    const shop = await createShop(env);
    const lines = Array.from(
      { length: 500 },
      (_, i) => `Produk ${i};Kategori ${i % 10};${1000 + i};;`,
    );
    const file = csv(...lines);
    const pv = await preview(shop, file);
    expect(pv.summary).toMatchObject({ create: 500, error: 0 });
    const t0 = performance.now();
    const res = await commit(shop, file, pv.import_token);
    const ms = performance.now() - t0;
    // eslint-disable-next-line no-console
    console.log(`product import commit, 500 new rows: ${ms.toFixed(0)} ms`);
    expect(res.statusCode, res.body).toBe(200);
    expect(ms).toBeLessThan(2000);
    // Now update all 500 (price change) and measure again.
    const updated = csv(...lines.map((l, i) => `Produk ${i};Kategori ${i % 10};${2000 + i};;`));
    const pv2 = await preview(shop, updated);
    expect(pv2.summary).toMatchObject({ update: 500 });
    const t1 = performance.now();
    const res2 = await commit(shop, updated, pv2.import_token);
    const ms2 = performance.now() - t1;
    // eslint-disable-next-line no-console
    console.log(`product import commit, 500 updated rows: ${ms2.toFixed(0)} ms`);
    expect(res2.statusCode, res2.body).toBe(200);
    expect(ms2).toBeLessThan(2000);
    expect(await auditOf(shop, 'product.price_changed')).toHaveLength(500);
  });
});

describe('rate limit', () => {
  it('shares 20 requests per minute between preview and commit', async () => {
    const shop = await createShop(env);
    const file = csv('Es Teh;Minuman;5000;;');
    const statuses: number[] = [];
    for (let i = 0; i < 21; i += 1) {
      const url = i % 2 === 0 ? '/v1/products/import/preview' : '/v1/products/import/commit';
      statuses.push((await upload(url, shop.ownerToken, file, { import_token: 'x' })).statusCode);
    }
    expect(statuses.slice(0, 20)).not.toContain(429);
    expect(statuses[20]).toBe(429);
  });
});
