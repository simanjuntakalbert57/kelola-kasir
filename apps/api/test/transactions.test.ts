import { and, count, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { auditLogs, transactionItems, transactions } from '../src/db/schema.js';
import { pgError } from '../src/db/client.js';
import {
  bearer,
  cashierSession,
  createShop,
  createTestEnv,
  first,
  get,
  json,
  newShiftId,
  patch,
  post,
  seedTransaction,
  txBody,
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

interface TxDto {
  id: string;
  number: string;
  status: string;
  payment_method: string;
  total: number;
  subtotal: number;
  discount_amount: number;
  item_count: number;
  price_mismatch: boolean;
  after_shift_close: boolean;
  employee: { id: string; name: string };
  items: { product_name: string; unit_price: number; quantity: number; line_total: number }[];
  payments: {
    method: string;
    status: string;
    cash_tendered: number | null;
    cash_change: number | null;
  }[];
  paid_at: string | null;
}

const create = (shop: Shop, body: unknown, headers = shop.cashier.headers) =>
  post(env, '/v1/transactions', headers, body);

const auditFor = async (shop: Shop, action: string) =>
  env.handle.db
    .select()
    .from(auditLogs)
    .where(and(eq(auditLogs.outletId, shop.seeded.outletId), eq(auditLogs.action, action)));

describe('create cash transaction', () => {
  it('stores the sale as paid with snapshot, change and the cashier', async () => {
    const shop = await createShop(env);
    const body = txBody(env, shop, { qty: 3, tendered: 50_000 });
    const res = await create(shop, body);
    expect(res.statusCode).toBe(201);
    const tx = json<TxDto>(res);
    expect(tx).toMatchObject({
      id: body.id,
      number: body.number,
      status: 'paid',
      payment_method: 'cash',
      total: 45_000,
      subtotal: 45_000,
      item_count: 3,
      price_mismatch: false,
      after_shift_close: false,
      employee: { id: shop.cashier.employeeId },
    });
    expect(tx.items).toEqual([
      expect.objectContaining({
        product_name: 'Jus Alpukat',
        unit_price: 15_000,
        quantity: 3,
        line_total: 45_000,
      }),
    ]);
    expect(tx.payments[0]).toMatchObject({
      method: 'cash',
      status: 'paid',
      cash_tendered: 50_000,
      cash_change: 5_000,
    });
    expect(tx.paid_at).toBe(body.client_created_at);
  });

  it('keeps the price snapshot when the catalog price changes afterwards', async () => {
    const shop = await createShop(env);
    const body = txBody(env, shop);
    const tx = json<TxDto>(await create(shop, body));
    await patch(env, `/v1/products/${shop.product.id}`, bearer(shop.ownerToken), { price: 99_000 });
    const detail = json<TxDto>(await get(env, `/v1/transactions/${tx.id}`, shop.cashier.headers));
    expect(detail.items[0]).toMatchObject({ unit_price: 15_000, line_total: 30_000 });
    expect(detail.total).toBe(30_000);
  });

  it('applies a discount to the total', async () => {
    const shop = await createShop(env);
    const ok = await create(shop, txBody(env, shop, { qty: 2, discount: 5_000, tendered: 25_000 }));
    expect(ok.statusCode).toBe(201);
    expect(json<TxDto>(ok)).toMatchObject({
      subtotal: 30_000,
      discount_amount: 5_000,
      total: 25_000,
    });
  });

  it('is idempotent on the transaction id (replay returns 200 and no duplicate)', async () => {
    const shop = await createShop(env);
    const body = txBody(env, shop);
    const first = await create(shop, body);
    const second = await create(shop, body);
    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(200);
    expect(json<TxDto>(second).id).toBe(json<TxDto>(first).id);
    const [rows] = await env.handle.db
      .select({ n: count() })
      .from(transactions)
      .where(eq(transactions.id, body.id));
    expect(rows?.n).toBe(1);
    const [items] = await env.handle.db
      .select({ n: count() })
      .from(transactionItems)
      .where(eq(transactionItems.transactionId, body.id));
    expect(items?.n).toBe(1);
  });

  it('survives concurrent retries of the same request', async () => {
    const shop = await createShop(env);
    const body = txBody(env, shop);
    const results = await Promise.all(Array.from({ length: 6 }, () => create(shop, body)));
    const codes = results.map((r) => r.statusCode);
    expect(codes.every((c) => c === 200 || c === 201)).toBe(true);
    expect(codes.filter((c) => c === 201)).toHaveLength(1);
    const [rows] = await env.handle.db
      .select({ n: count() })
      .from(transactions)
      .where(eq(transactions.id, body.id));
    expect(rows?.n).toBe(1);
  });

  it('refuses a transaction number that is already used (NUMBER_CONFLICT)', async () => {
    const shop = await createShop(env);
    const a = txBody(env, shop);
    await create(shop, a);
    const res = await create(shop, { ...txBody(env, shop), number: a.number });
    expect(res.statusCode).toBe(409);
    expect(json(res)).toMatchObject({ code: 'NUMBER_CONFLICT' });
  });

  it('refuses ids that belong to another outlet (ID_CONFLICT)', async () => {
    const shop = await createShop(env);
    const other = await createShop(env);
    const body = txBody(env, shop);
    await create(shop, body);
    const res = await create(other, { ...txBody(env, other), id: body.id });
    expect(res.statusCode).toBe(409);
    expect(json(res)).toMatchObject({ code: 'ID_CONFLICT' });
    const reusedItem = txBody(env, other);
    first(reusedItem.items).id = first(body.items).id;
    expect((await create(other, reusedItem)).statusCode).toBe(409);
  });

  it('requires the number to carry the outlet and device code', async () => {
    const shop = await createShop(env);
    const wrongDevice = { ...txBody(env, shop), number: `${shop.seeded.code}-Z99-261026-0001` };
    const wrongOutlet = { ...txBody(env, shop), number: 'ZZZZ-K01-261026-0001' };
    for (const body of [wrongDevice, wrongOutlet, { ...txBody(env, shop), number: 'nope' }]) {
      const res = await create(shop, body);
      expect(res.statusCode).toBe(400);
      expect(json(res)).toMatchObject({ code: 'VALIDATION_ERROR' });
    }
  });
});

describe('server-side validation', () => {
  it.each([
    [
      'line_total',
      (b: ReturnType<typeof txBody>) => {
        first(b.items).line_total += 1;
      },
    ],
    [
      'subtotal',
      (b: ReturnType<typeof txBody>) => {
        b.subtotal += 1;
        b.total += 1;
      },
    ],
    [
      'total',
      (b: ReturnType<typeof txBody>) => {
        b.total -= 1;
      },
    ],
    [
      'discount above subtotal',
      (b: ReturnType<typeof txBody>) => {
        b.discount_amount = b.subtotal + 1;
        b.total = 0;
      },
    ],
    [
      'tax not added',
      (b: ReturnType<typeof txBody>) => {
        b.tax_amount = 100;
      },
    ],
  ])('rejects inconsistent %s with TOTAL_MISMATCH', async (_name, mutate) => {
    const shop = await createShop(env);
    const body = txBody(env, shop);
    mutate(body);
    const res = await create(shop, body);
    expect(res.statusCode).toBe(422);
    expect(json(res)).toMatchObject({ code: 'TOTAL_MISMATCH' });
    const [rows] = await env.handle.db
      .select({ n: count() })
      .from(transactions)
      .where(eq(transactions.id, body.id));
    expect(rows?.n).toBe(0);
  });

  it('rejects insufficient cash with CASH_INSUFFICIENT', async () => {
    const shop = await createShop(env);
    const res = await create(shop, txBody(env, shop, { tendered: 29_999 }));
    expect(res.statusCode).toBe(422);
    expect(json(res)).toMatchObject({ code: 'CASH_INSUFFICIENT' });
  });

  it.each([
    ['no items', (b: ReturnType<typeof txBody>) => (b.items = [])],
    ['zero quantity', (b: ReturnType<typeof txBody>) => (first(b.items).quantity = 0)],
    ['huge quantity', (b: ReturnType<typeof txBody>) => (first(b.items).quantity = 1000)],
    ['negative price', (b: ReturnType<typeof txBody>) => (first(b.items).unit_price = -1)],
    ['bad date', (b: ReturnType<typeof txBody>) => (b.client_created_at = 'yesterday')],
    [
      'long label',
      (b: ReturnType<typeof txBody>) => Object.assign(b, { customer_label: 'x'.repeat(41) }),
    ],
  ])('rejects malformed input: %s', async (_name, mutate) => {
    const shop = await createShop(env);
    const body = txBody(env, shop);
    mutate(body);
    expect((await create(shop, body)).statusCode).toBe(400);
  });

  it('rejects the same item id twice in one request', async () => {
    const shop = await createShop(env);
    const body = txBody(env, shop, { qty: 1 });
    const second = { ...first(body.items), id: first(body.items).id };
    body.items.push(second);
    body.subtotal *= 2;
    body.total *= 2;
    body.payment = { id: body.payment.id, method: 'cash', cash_tendered: body.total } as never;
    expect((await create(shop, body)).statusCode).toBe(400);
  });

  it('rejects unavailable products online (sold out, inactive, deleted, unknown)', async () => {
    const shop = await createShop(env);
    const owner = bearer(shop.ownerToken);
    const attempt = async () => create(shop, txBody(env, shop));

    await patch(env, `/v1/products/${shop.product.id}/availability`, owner, { is_sold_out: true });
    let res = await attempt();
    expect(res.statusCode).toBe(422);
    expect(json(res)).toMatchObject({ code: 'PRODUCT_UNAVAILABLE' });
    await patch(env, `/v1/products/${shop.product.id}/availability`, owner, { is_sold_out: false });

    await patch(env, `/v1/products/${shop.product.id}`, owner, { is_active: false });
    expect((await attempt()).statusCode).toBe(422);
    await patch(env, `/v1/products/${shop.product.id}`, owner, { is_active: true });
    expect((await attempt()).statusCode).toBe(201);

    const unknown = txBody(env, shop);
    first(unknown.items).product_id = '019a0000-0000-7000-8000-00000000abcd';
    res = await create(shop, unknown);
    expect(res.statusCode).toBe(422);
    expect(json(res)).toMatchObject({ code: 'PRODUCT_UNAVAILABLE' });

    await env.app.inject({
      method: 'DELETE',
      url: `/v1/products/${shop.product.id}`,
      headers: owner,
    });
    expect((await attempt()).statusCode).toBe(422);
  });

  it('accepts a stale price but flags it and writes an audit entry', async () => {
    const shop = await createShop(env);
    await patch(env, `/v1/products/${shop.product.id}`, bearer(shop.ownerToken), { price: 17_000 });
    const res = await create(shop, txBody(env, shop, { unitPrice: 15_000 }));
    expect(res.statusCode).toBe(201);
    const tx = json<TxDto>(res);
    expect(tx.price_mismatch).toBe(true);
    expect(tx.total).toBe(30_000); // the customer pays the price they saw
    const [entry] = await auditFor(shop, 'sync.price_mismatch');
    expect(entry?.entityId).toBe(tx.id);
    expect(entry?.after).toEqual({
      items: [{ product_id: shop.product.id, catalog_price: 17_000, snapshot_price: 15_000 }],
    });
  });

  it('flags a device clock running ahead in the audit log', async () => {
    const shop = await createShop(env);
    const ahead = new Date(env.clock.now.getTime() + 11 * 60_000);
    expect((await create(shop, txBody(env, shop, { createdAt: ahead }))).statusCode).toBe(201);
    expect(await auditFor(shop, 'transaction.clock_skew')).toHaveLength(1);
    const fine = new Date(env.clock.now.getTime() + 5 * 60_000);
    await create(shop, txBody(env, shop, { createdAt: fine }));
    expect(await auditFor(shop, 'transaction.clock_skew')).toHaveLength(1);
  });
});

describe('shift rules', () => {
  it('answers SHIFT_NOT_OPEN for an unknown shift and SHIFT_CLOSED for a closed one', async () => {
    const shop = await createShop(env);
    const unknown = await create(shop, txBody(env, shop, { shiftId: newShiftId() }));
    expect(unknown.statusCode).toBe(409);
    expect(json(unknown)).toMatchObject({ code: 'SHIFT_NOT_OPEN' });

    const close = await post(env, `/v1/shifts/${shop.shiftId}/close`, shop.cashier.headers, {
      actual_cash: 100_000,
      closed_at: env.clock.now.toISOString(),
    });
    expect(close.statusCode).toBe(200);
    const closed = await create(shop, txBody(env, shop));
    expect(closed.statusCode).toBe(409);
    expect(json(closed)).toMatchObject({ code: 'SHIFT_CLOSED' });
  });

  it('does not let one outlet sell into the shift of another', async () => {
    const shop = await createShop(env);
    const other = await createShop(env);
    const res = await create(shop, txBody(env, shop, { shiftId: other.shiftId }));
    expect(res.statusCode).toBe(409);
    expect(json(res)).toMatchObject({ code: 'SHIFT_NOT_OPEN' });
  });

  it('records each cashier on a shared shift and feeds the shift summary', async () => {
    const shop = await createShop(env);
    const budi = await cashierSession(
      env,
      shop.seeded,
      { token: shop.ownerToken },
      shop.device,
      'Budi',
    );
    await create(shop, txBody(env, shop, { qty: 2 }));
    const second = await create(shop, txBody(env, shop, { qty: 1 }), budi.headers);
    expect(json<TxDto>(second).employee).toMatchObject({ id: budi.employeeId, name: 'Budi' });
    const summary = json<{ total_cash_sales: number; transaction_count: number }>(
      await get(env, `/v1/shifts/${shop.shiftId}/summary`, shop.cashier.headers),
    );
    expect(summary).toMatchObject({ total_cash_sales: 45_000, transaction_count: 2 });
  });
});

describe('immutability of paid transactions (DB trigger)', () => {
  it('rejects updating the financial columns of a paid transaction created through the API', async () => {
    const shop = await createShop(env);
    const tx = json<TxDto>(await create(shop, txBody(env, shop)));
    const attempt = async (patchValues: Partial<typeof transactions.$inferInsert>) => {
      try {
        await env.handle.db.update(transactions).set(patchValues).where(eq(transactions.id, tx.id));
        return undefined;
      } catch (err) {
        return pgError(err);
      }
    };
    expect(await attempt({ total: 1, subtotal: 1 })).toMatchObject({ code: '23514' });
    expect(await attempt({ paymentMethod: 'qris' })).toMatchObject({ code: '23514' });
    expect(await attempt({ employeeId: shop.cashier.employeeId, number: 'X' })).toMatchObject({
      code: '23514',
    });
    // Items are frozen too, and the row cannot be deleted.
    await expect(
      env.handle.db
        .update(transactionItems)
        .set({ quantity: 9 })
        .where(eq(transactionItems.transactionId, tx.id)),
    ).rejects.toThrow();
    await expect(
      env.handle.db.delete(transactions).where(eq(transactions.id, tx.id)),
    ).rejects.toThrow();
    const after = json<TxDto>(await get(env, `/v1/transactions/${tx.id}`, shop.cashier.headers));
    expect(after.total).toBe(30_000);
  });

  it('has no API to edit or delete a transaction', async () => {
    const shop = await createShop(env);
    const tx = json<TxDto>(await create(shop, txBody(env, shop)));
    for (const method of ['PATCH', 'PUT', 'DELETE'] as const) {
      const res = await env.app.inject({
        method,
        url: `/v1/transactions/${tx.id}`,
        headers: bearer(shop.ownerToken),
        ...(method === 'DELETE' ? {} : { payload: { total: 1 } }),
      });
      expect(res.statusCode).toBe(404);
    }
  });
});

describe('listing and detail are scoped by role', () => {
  async function scenario() {
    const shop = await createShop(env);
    const budi = await cashierSession(
      env,
      shop.seeded,
      { token: shop.ownerToken },
      shop.device,
      'Budi',
    );
    const mine = json<TxDto>(await create(shop, txBody(env, shop, { qty: 1 })));
    const theirs = json<TxDto>(await create(shop, txBody(env, shop, { qty: 2 }), budi.headers));
    return { shop, budi, mine, theirs };
  }

  it('shows an employee the running shift of the outlet, newest first, with all cashiers', async () => {
    const { shop, mine, theirs } = await scenario();
    const res = await get(env, '/v1/transactions', shop.cashier.headers);
    expect(res.statusCode).toBe(200);
    const body = json<{ data: TxDto[]; next_cursor: string | null }>(res);
    expect(body.data.map((t) => t.id)).toEqual([theirs.id, mine.id]);
    expect(body.next_cursor).toBeNull();
    expect(body.data[0]).not.toHaveProperty('items');
    expect(body.data[0]?.item_count).toBe(2);
  });

  it('ignores owner-only filters for employees', async () => {
    const { shop, mine } = await scenario();
    const res = await get(
      env,
      `/v1/transactions?employee_id=${mine.employee.id}&date_from=2000-01-01&date_to=2000-01-02`,
      shop.cashier.headers,
    );
    expect(json<{ data: TxDto[] }>(res).data).toHaveLength(2);
  });

  it('limits an employee to the open shift or today, never older closed shifts', async () => {
    const shop = await createShop(env);
    const old = new Date(env.clock.now.getTime() - 3 * 24 * 3600_000);
    // An old, closed shift with a sale from three days ago.
    const oldShiftId = newShiftId();
    await post(env, `/v1/shifts/${shop.shiftId}/close`, shop.cashier.headers, {
      actual_cash: 100_000,
      closed_at: env.clock.now.toISOString(),
    });
    const oldTx = await seedTransaction(env, {
      shiftId: shop.shiftId,
      outletId: shop.seeded.outletId,
      deviceId: shop.device.id,
      employeeId: shop.cashier.employeeId,
      total: 10_000,
      createdAt: old,
    });
    await post(env, '/v1/shifts', shop.cashier.headers, {
      id: oldShiftId,
      opening_cash: 0,
      opened_at: env.clock.now.toISOString(),
    });
    const fresh = json<TxDto>(await create(shop, txBody(env, shop, { shiftId: oldShiftId })));

    const shiftScope = json<{ data: TxDto[] }>(
      await get(env, '/v1/transactions', shop.cashier.headers),
    );
    expect(shiftScope.data.map((t) => t.id)).toEqual([fresh.id]);
    const today = json<{ data: TxDto[] }>(
      await get(env, '/v1/transactions?scope=today', shop.cashier.headers),
    );
    expect(today.data.map((t) => t.id)).toEqual([fresh.id]);

    const detail = await get(env, `/v1/transactions/${oldTx}`, shop.cashier.headers);
    expect(detail.statusCode).toBe(403);
    expect(
      (await get(env, `/v1/transactions/${oldTx}/receipt`, shop.cashier.headers)).statusCode,
    ).toBe(403);
    // The owner sees everything.
    expect((await get(env, `/v1/transactions/${oldTx}`, bearer(shop.ownerToken))).statusCode).toBe(
      200,
    );
  });

  it('returns nothing for scope=shift while no shift is open', async () => {
    const shop = await createShop(env);
    await create(shop, txBody(env, shop));
    await post(env, `/v1/shifts/${shop.shiftId}/close`, shop.cashier.headers, {
      actual_cash: 130_000,
      closed_at: env.clock.now.toISOString(),
    });
    const res = json<{ data: unknown[] }>(await get(env, '/v1/transactions', shop.cashier.headers));
    expect(res.data).toHaveLength(0);
    const today = json<{ data: unknown[] }>(
      await get(env, '/v1/transactions?scope=today', shop.cashier.headers),
    );
    expect(today.data).toHaveLength(1);
  });

  it('lets the owner filter by employee, method, status, shift and text, and paginate', async () => {
    const { shop, budi, mine, theirs } = await scenario();
    const owner = bearer(shop.ownerToken);
    const ids = async (qs: string) =>
      json<{ data: TxDto[] }>(await get(env, `/v1/transactions?${qs}`, owner)).data.map(
        (t) => t.id,
      );

    expect(await ids(`employee_id=${budi.employeeId}`)).toEqual([theirs.id]);
    expect(await ids('payment_method=cash')).toHaveLength(2);
    expect(await ids('payment_method=qris')).toEqual([]);
    expect(await ids('status=voided')).toEqual([]);
    expect(await ids(`shift_id=${shop.shiftId}`)).toHaveLength(2);
    expect(await ids(`q=${mine.number.slice(-9)}`)).toEqual([mine.id]);
    const today = env.clock.now.toISOString().slice(0, 10);
    expect(await ids(`date_from=${today}&date_to=${today}`)).toHaveLength(2);
    expect(await ids('date_from=2000-01-01&date_to=2000-01-31')).toEqual([]);

    const page1 = json<{ data: TxDto[]; next_cursor: string }>(
      await get(env, '/v1/transactions?limit=1', owner),
    );
    expect(page1.data.map((t) => t.id)).toEqual([theirs.id]);
    expect(page1.next_cursor).toBeTruthy();
    const page2 = json<{ data: TxDto[]; next_cursor: string | null }>(
      await get(env, `/v1/transactions?limit=1&cursor=${page1.next_cursor}`, owner),
    );
    expect(page2.data.map((t) => t.id)).toEqual([mine.id]);
    expect(page2.next_cursor).toBeNull();
    expect((await get(env, '/v1/transactions?cursor=bogus', owner)).statusCode).toBe(400);
  });

  it('never crosses outlets', async () => {
    const { mine } = await scenario();
    const other = await createShop(env);
    expect(
      json<{ data: unknown[] }>(await get(env, '/v1/transactions', other.cashier.headers)).data,
    ).toHaveLength(0);
    expect((await get(env, `/v1/transactions/${mine.id}`, other.cashier.headers)).statusCode).toBe(
      404,
    );
    expect(
      (await get(env, `/v1/transactions/${mine.id}`, bearer(other.ownerToken))).statusCode,
    ).toBe(404);
    expect((await get(env, `/v1/transactions/${mine.id}`, {})).statusCode).toBe(401);
  });

  it('only employees can create transactions', async () => {
    const shop = await createShop(env);
    const res = await post(env, '/v1/transactions', bearer(shop.ownerToken), txBody(env, shop));
    expect(res.statusCode).toBe(403);
  });
});

describe('receipt', () => {
  it('builds a 32-column text receipt with the store header and footer', async () => {
    const shop = await createShop(env);
    await patch(env, '/v1/settings', bearer(shop.ownerToken), {
      display_name: 'Jus Segar Medan',
      address: 'Jl. Melati No. 5, Medan',
      phone: '0812-3456-7890',
      receipt_header: '@jussegar',
      receipt_footer: 'Terima kasih, sampai jumpa!',
    });
    const tx = json<TxDto>(await create(shop, txBody(env, shop, { qty: 2, tendered: 50_000 })));
    const res = await get(env, `/v1/transactions/${tx.id}/receipt`, shop.cashier.headers);
    expect(res.statusCode).toBe(200);
    const receipt = json<{
      store: { name: string; footer: string };
      cashier_name: string;
      paper_width_mm: number;
      share_text: string;
      transaction: TxDto;
    }>(res);
    expect(receipt).toMatchObject({
      store: { name: 'Jus Segar Medan', footer: 'Terima kasih, sampai jumpa!' },
      cashier_name: 'Siti',
      paper_width_mm: 58,
      transaction: { id: tx.id },
    });
    const lines = receipt.share_text.split('\n');
    expect(Math.max(...lines.map((l) => l.length))).toBeLessThanOrEqual(32);
    expect(receipt.share_text).toContain('Jus Segar Medan');
    expect(receipt.share_text).toContain('@jussegar');
    expect(receipt.share_text).toContain(tx.number);
    expect(receipt.share_text).toContain('Jus Alpukat');
    expect(receipt.share_text).toMatch(/2 x Rp15\.000\s+Rp30\.000/);
    expect(receipt.share_text).toMatch(/TOTAL\s+Rp30\.000/);
    expect(receipt.share_text).toMatch(/Kembali\s+Rp20\.000/);
    expect(receipt.share_text).toContain('Terima kasih, sampai jumpa!');
  });

  it('wraps very long names inside 32 columns', async () => {
    const shop = await createShop(env);
    const body = txBody(env, shop, { qty: 1 });
    first(body.items).product_name = 'Jus Campur Spesial Buah Naga Madu Tanpa Gula Extra Dingin';
    const tx = json<TxDto>(await create(shop, body));
    const receipt = json<{ share_text: string }>(
      await get(env, `/v1/transactions/${tx.id}/receipt`, bearer(shop.ownerToken)),
    );
    expect(Math.max(...receipt.share_text.split('\n').map((l) => l.length))).toBeLessThanOrEqual(
      32,
    );
  });
});
