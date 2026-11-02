import { eq } from 'drizzle-orm';
import ExcelJS from 'exceljs';
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
  seedTransaction,
  type Shop,
  type TestEnv,
} from './helpers.js';
import {
  addMembership,
  categoryId,
  createMember,
  expenseBody,
  loginAs,
  seedCategories,
  setOperationsStart,
  switchTo,
} from './branch-helpers.js';

let env: TestEnv;
beforeAll(async () => {
  env = await createTestEnv();
});
afterAll(async () => {
  await env.close();
});

/** WIB (UTC+7) wall-clock instant. */
const wib = (day: string, hhmm: string): Date => new Date(`${day}T${hhmm}:00+07:00`);

interface Cell {
  revenue: number;
  transaction_count: number;
  expense_total: number;
  expense_count: number;
  profit: number;
  by_group: Record<string, number>;
  by_funding_source: Record<string, number>;
  by_category: {
    category_id: string | null;
    group: string;
    name: string;
    amount: number;
    count: number;
  }[];
}
type OutletCell = Cell & { outlet_id: string; counted_from: string | null };
interface Report {
  month_from: string;
  month_to: string;
  outlets: { id: string; operations_started_on: string | null }[];
  months: { month: string; per_outlet: OutletCell[]; total: Cell }[];
  total: { per_outlet: OutletCell[]; total: Cell };
}

const sale = (shop: Shop, total: number, at: Date, status?: 'void_requested' | 'voided') =>
  seedTransaction(env, {
    shiftId: shop.shiftId,
    outletId: shop.seeded.outletId,
    deviceId: shop.cashier.deviceId,
    employeeId: shop.cashier.employeeId,
    total,
    createdAt: at,
    ...(status ? { status } : {}),
  });

/** Outlet A (with sales and expenses) and outlet B; the owner of A is owner of both. */
async function setup() {
  const a = await createShop(env, { qris: false });
  const b = await createShop(env, { qris: false });
  await seedCategories(env, a.seeded.outletId);
  await seedCategories(env, b.seeded.outletId);
  await addMembership(env, a.seeded.ownerEmail, b.seeded.outletId, 'owner');
  const headersA = (await loginAs(env, a.seeded.ownerEmail, a.seeded.outletId)).headers;
  const headersB = await switchTo(env, headersA, b.seeded.outletId);

  await sale(a, 15_000, wib('2026-03-10', '10:00'));
  await sale(a, 5_000, wib('2026-03-31', '23:30'), 'void_requested');
  await sale(a, 7_000, wib('2026-03-12', '10:00'), 'voided');
  const gone = await sale(a, 9_999, wib('2026-03-13', '10:00'));
  const removed = await env.app.inject({
    method: 'DELETE',
    url: `/v1/transactions/${gone}`,
    headers: headersA,
    payload: { reason: 'Salah input' },
  });
  expect(removed.statusCode, removed.body).toBe(200);
  await sale(a, 20_000, wib('2026-04-01', '00:30'));
  await sale(b, 8_000, wib('2026-03-15', '09:00'));
  await sale(b, 12_000, wib('2026-04-02', '09:00'));

  const spend = async (headers: Record<string, string>, name: string, over: object) => {
    const res = await post(
      env,
      '/v1/expenses',
      headers,
      expenseBody(await categoryId(env, headers, name), over),
    );
    expect(res.statusCode, res.body).toBe(201);
    return json<{ id: string }>(res);
  };
  await spend(headersA, 'Buah', { spent_on: '2026-03-05', amount: 100_000 });
  await spend(headersA, 'Gas', {
    spent_on: '2026-03-20',
    amount: 50_000,
    funding_source: 'drawer',
  });
  await spend(headersA, 'Buah', { spent_on: '2026-04-02', amount: 30_000 });
  const dropped = await spend(headersA, 'Buah', { spent_on: '2026-03-07', amount: 999 });
  await env.app.inject({
    method: 'DELETE',
    url: `/v1/expenses/${dropped.id}`,
    headers: headersA,
    payload: { reason: 'Dobel catat' },
  });
  await spend(headersB, 'Buah', { spent_on: '2026-04-03', amount: 5_000 });
  return { a, b, headersA, headersB };
}

const report = async (headers: Record<string, string>, query: string) => {
  const res = await get(env, `/v1/reports/expenses?${query}`, headers);
  expect(res.statusCode, res.body).toBe(200);
  return json<Report>(res);
};
const summary = async (headers: Record<string, string>, from: string, to: string) =>
  json<{ revenue: number; transaction_count: number }>(
    await get(env, `/v1/dashboard/summary?date_from=${from}&date_to=${to}`, headers),
  );

describe('GET /reports/expenses', () => {
  it('reports revenue like the dashboard, excludes deleted expenses and fills empty months', async () => {
    const s = await setup();
    const r = await report(s.headersA, 'month_from=2026-02&month_to=2026-04');
    expect(r.months.map((m) => m.month)).toEqual(['2026-02', '2026-03', '2026-04']);
    const [feb, mar, apr] = r.months.map((m) => m.total);
    expect(feb).toMatchObject({
      revenue: 0,
      transaction_count: 0,
      expense_total: 0,
      profit: 0,
      by_category: [],
    });

    const dash = await summary(s.headersA, '2026-03-01', '2026-03-31');
    expect(mar?.revenue).toBe(dash.revenue);
    expect(mar?.transaction_count).toBe(dash.transaction_count);
    expect(mar).toMatchObject({
      revenue: 20_000, // paid + void_requested; voided and deleted do not count
      transaction_count: 2,
      expense_total: 150_000,
      expense_count: 2,
      profit: -130_000,
      by_group: { hpp: 100_000, operasional: 50_000, tetap: 0, lainnya: 0 },
      by_funding_source: { drawer: 50_000, owner: 100_000 },
    });
    expect(mar?.by_category.map((c) => [c.name, c.amount, c.count])).toEqual([
      ['Buah', 100_000, 1],
      ['Gas', 50_000, 1],
    ]);
    // 00:30 WIB on 1 April is April, although it is still 31 March in UTC.
    expect(apr).toMatchObject({ revenue: 20_000, expense_total: 30_000, profit: -10_000 });
    expect(r.total.total).toMatchObject({
      revenue: 40_000,
      expense_total: 180_000,
      profit: -140_000,
    });
    expect(r.total.per_outlet).toHaveLength(1);
    expect(r.months.every((m) => m.per_outlet.every((c) => c.counted_from === null))).toBe(true);
  });

  it('defaults to the current month and validates the period', async () => {
    const s = await setup();
    const now = new Date().toISOString().slice(0, 7);
    const r = await report(s.headersA, '');
    expect(r.months.map((m) => m.month)).toEqual([now]);
    expect(
      (await get(env, '/v1/reports/expenses?month_from=2026-04&month_to=2026-03', s.headersA))
        .statusCode,
    ).toBe(400);
    expect((await get(env, '/v1/reports/expenses?month_from=2026-13', s.headersA)).statusCode).toBe(
      400,
    );
    expect(
      (await get(env, '/v1/reports/expenses?month_from=2025-01&month_to=2026-01', s.headersA))
        .statusCode,
    ).toBe(400);
    expect(
      (await get(env, '/v1/reports/expenses?month_from=2025-02&month_to=2026-01', s.headersA))
        .statusCode,
    ).toBe(200);
  });

  it('counts only from the operations start (partial month), and everything with include_pre_operations', async () => {
    const s = await setup();
    await setOperationsStart(env, s.a.seeded.outletId, '2026-03-11');
    const r = await report(s.headersA, 'month_from=2026-02&month_to=2026-04');
    const [feb, mar, apr] = r.months;
    expect(feb?.per_outlet[0]).toMatchObject({
      revenue: 0,
      expense_total: 0,
      counted_from: '2026-03-11',
    });
    expect(mar?.per_outlet[0]).toMatchObject({
      revenue: 5_000, // the 10 March sale is before the start, the 31 March one after
      expense_total: 50_000, // 5 March is before the start, 20 March after
      counted_from: '2026-03-11',
    });
    expect(apr?.per_outlet[0]).toMatchObject({
      revenue: 20_000,
      expense_total: 30_000,
      counted_from: null,
    });
    expect(r.total.per_outlet[0]).toMatchObject({ revenue: 25_000, counted_from: '2026-03-11' });
    expect(r.outlets[0]?.operations_started_on).toBe('2026-03-11');

    // The start day itself counts.
    await setOperationsStart(env, s.a.seeded.outletId, '2026-03-10');
    const onDay = await report(s.headersA, 'month_from=2026-03&month_to=2026-03');
    expect(onDay.months[0]?.total.revenue).toBe(20_000);
    expect(onDay.months[0]?.per_outlet[0]?.counted_from).toBe('2026-03-10');
    // A start on the first day of the month counts the whole month: no `counted_from`.
    await setOperationsStart(env, s.a.seeded.outletId, '2026-03-01');
    expect(
      (await report(s.headersA, 'month_from=2026-03&month_to=2026-03')).months[0]?.per_outlet[0]
        ?.counted_from,
    ).toBeNull();

    await setOperationsStart(env, s.a.seeded.outletId, '2026-03-11');
    const pre = await report(
      s.headersA,
      'month_from=2026-03&month_to=2026-03&include_pre_operations=true',
    );
    const dash = await summary(s.headersA, '2026-03-01', '2026-03-31');
    expect(pre.months[0]?.total.revenue).toBe(dash.revenue);
    expect(pre.months[0]?.per_outlet[0]?.counted_from).toBeNull();
    expect(pre.months[0]?.total.expense_total).toBe(150_000);
    // The dashboard summary ignores the start date.
    expect(dash.revenue).toBe(20_000);
  });

  it('combines two outlets with different start dates and merges categories by group and name', async () => {
    const s = await setup();
    await setOperationsStart(env, s.b.seeded.outletId, '2026-04-01');
    const r = await report(s.headersA, 'outlet_scope=all&month_from=2026-03&month_to=2026-04');
    expect(r.outlets).toHaveLength(2);
    const ids = new Set(r.outlets.map((o) => o.id));
    expect(ids).toEqual(new Set([s.a.seeded.outletId, s.b.seeded.outletId]));
    const cell = (month: string, outlet: string) =>
      r.months
        .find((m) => m.month === month)
        ?.per_outlet.find((c) => c.outlet_id === outlet) as OutletCell;

    // B starts on 1 April: March is "belum beroperasi" there, April is whole.
    expect(cell('2026-03', s.b.seeded.outletId)).toMatchObject({
      revenue: 0,
      counted_from: '2026-04-01',
    });
    expect(cell('2026-04', s.b.seeded.outletId)).toMatchObject({
      revenue: 12_000,
      expense_total: 5_000,
      counted_from: null,
    });
    expect(cell('2026-03', s.a.seeded.outletId)).toMatchObject({
      revenue: 20_000,
      counted_from: null,
    });

    const march = r.months[0]?.total;
    expect(march).toMatchObject({ revenue: 20_000, expense_total: 150_000 });
    const april = r.months[1]?.total;
    expect(april).toMatchObject({ revenue: 32_000, expense_total: 35_000, profit: -3_000 });
    // "Buah" of A (30.000) and of B (5.000) are one line without a category id.
    expect(april?.by_category).toEqual([
      { category_id: null, group: 'hpp', name: 'Buah', amount: 35_000, count: 2 },
    ]);
    expect(r.total.total).toMatchObject({ revenue: 52_000, expense_total: 185_000 });
    expect(r.total.per_outlet.find((c) => c.outlet_id === s.b.seeded.outletId)?.counted_from).toBe(
      '2026-04-01',
    );
    // `current` stays on the active outlet.
    const current = await report(s.headersA, 'month_from=2026-04&month_to=2026-04');
    expect(current.months[0]?.per_outlet).toHaveLength(1);
    expect(current.months[0]?.total.revenue).toBe(20_000);
  });

  it('is available to a manager of the active outlet only for that outlet', async () => {
    const s = await setup();
    const manager = await createMember(env, s.a.seeded, 'manager');
    const r = await report(manager.headers, 'month_from=2026-03&month_to=2026-03');
    expect(r.months[0]?.total.revenue).toBe(20_000);
    expect(
      (await get(env, '/v1/reports/expenses?outlet_scope=all', manager.headers)).statusCode,
    ).toBe(403);
  });
});

describe('PATCH /settings operations_started_on', () => {
  it('lets the owner set, read and clear it with an audit trail; devices never see it', async () => {
    const shop = await createShop(env, { qris: false });
    const headers = bearer(shop.ownerToken);
    const initial = json<Record<string, unknown>>(await get(env, '/v1/settings', headers));
    expect(initial['operations_started_on']).toBeNull();

    const set = await patch(env, '/v1/settings', headers, { operations_started_on: '2026-11-10' });
    expect(set.statusCode, set.body).toBe(200);
    expect(json<Record<string, unknown>>(set)['operations_started_on']).toBe('2026-11-10');
    expect(
      json<Record<string, unknown>>(await get(env, '/v1/settings', headers))[
        'operations_started_on'
      ],
    ).toBe('2026-11-10');
    const session = await loginAs(env, shop.seeded.ownerEmail);
    expect(session.session.user.outlets[0]?.operations_started_on).toBe('2026-11-10');

    const device = json<Record<string, unknown>>(
      await get(env, '/v1/settings', { 'x-device-token': shop.device.token }),
    );
    expect('operations_started_on' in device).toBe(false);

    const cleared = await patch(env, '/v1/settings', headers, { operations_started_on: null });
    expect(json<Record<string, unknown>>(cleared)['operations_started_on']).toBeNull();
    const audits = await env.handle.db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.entityId, shop.seeded.outletId));
    const updated = audits.filter((a) => a.action === 'settings.updated');
    expect(updated[0]?.before).toEqual({ operations_started_on: null });
    expect(updated[0]?.after).toEqual({ operations_started_on: '2026-11-10' });
    expect(updated[1]?.before).toEqual({ operations_started_on: '2026-11-10' });
  });

  it('limits the range', async () => {
    const shop = await createShop(env, { qris: false });
    const headers = bearer(shop.ownerToken);
    const inDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
    expect(
      (await patch(env, '/v1/settings', headers, { operations_started_on: '2019-12-31' }))
        .statusCode,
    ).toBe(400);
    expect(
      (await patch(env, '/v1/settings', headers, { operations_started_on: inDays(380) }))
        .statusCode,
    ).toBe(400);
    expect(
      (await patch(env, '/v1/settings', headers, { operations_started_on: inDays(300) }))
        .statusCode,
    ).toBe(200);
    expect(
      (await patch(env, '/v1/settings', headers, { operations_started_on: 'besok' })).statusCode,
    ).toBe(400);
  });

  it('refuses a manager sending the field without saving anything, but accepts other fields', async () => {
    const shop = await createShop(env, { qris: false });
    const manager = await createMember(env, shop.seeded, 'manager');
    const both = await patch(env, '/v1/settings', manager.headers, {
      operations_started_on: '2026-11-10',
      display_name: 'Dicoba manager',
    });
    expect(both.statusCode).toBe(403);
    const after = json<Record<string, unknown>>(
      await get(env, '/v1/settings', bearer(shop.ownerToken)),
    );
    expect(after['operations_started_on']).toBeNull();
    expect(after['display_name']).not.toBe('Dicoba manager');
    const ok = await patch(env, '/v1/settings', manager.headers, { display_name: 'Nama baru' });
    expect(ok.statusCode).toBe(200);
    expect(json<Record<string, unknown>>(ok)['operations_started_on']).toBeNull();
  });
});

describe('GET /expenses/export', () => {
  it('writes a CSV that follows the operations start, guards formulas and is audited', async () => {
    const s = await setup();
    const dangerous = await post(
      env,
      '/v1/expenses',
      s.headersA,
      expenseBody(await categoryId(env, s.headersA, 'Gas'), {
        description: '=HYPERLINK("x")',
        spent_on: '2026-03-25',
        amount: 1_000,
      }),
    );
    expect(dangerous.statusCode).toBe(201);
    await setOperationsStart(env, s.a.seeded.outletId, '2026-03-11');

    const res = await get(
      env,
      '/v1/expenses/export?format=csv&date_from=2026-03-01&date_to=2026-04-30',
      s.headersA,
    );
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.headers['content-disposition']).toContain('pengeluaran_2026-03-01_2026-04-30.csv');
    expect(
      res.body.startsWith(
        '﻿Tanggal,Cabang,Kelompok,Kategori,Keterangan,Jumlah,Sumber dana,Ada nota,Dicatat oleh,Dicatat pada (WIB)\r\n',
      ),
    ).toBe(true);
    const lines = res.body.trim().split('\r\n').slice(1);
    // 5 March is before the start; the deleted expense never appears.
    expect(lines.map((l) => l.split(',')[0])).toEqual(['2026-03-20', '2026-03-25', '2026-04-02']);
    expect(res.body).toContain(`"'=HYPERLINK(""x"")"`);
    expect(res.body).toContain(',Operasional,Gas,');
    expect(res.body).toContain(',Kas laci cabang,Tidak,');

    const pre = await get(
      env,
      '/v1/expenses/export?format=csv&include_pre_operations=true',
      s.headersA,
    );
    expect(pre.body.trim().split('\r\n')).toHaveLength(1 + 4);

    const audits = await env.handle.db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.outletId, s.a.seeded.outletId));
    expect(audits.filter((a) => a.action === 'expenses.exported')).toHaveLength(2);
    expect((await get(env, '/v1/expenses/export?format=pdf', s.headersA)).statusCode).toBe(400);
    expect((await get(env, '/v1/expenses/export', s.headersA)).statusCode).toBe(400);
  });

  it('writes an xlsx whose Rekap total equals the Pengeluaran sheet and the report', async () => {
    const s = await setup();
    await setOperationsStart(env, s.a.seeded.outletId, '2026-03-11');
    const res = await get(
      env,
      '/v1/expenses/export?format=xlsx&outlet_scope=all&date_from=2026-03-01&date_to=2026-04-30',
      s.headersA,
    );
    expect(res.statusCode).toBe(200);
    const book = new ExcelJS.Workbook();
    await book.xlsx.load(res.rawPayload as unknown as ArrayBuffer);
    expect(book.worksheets.map((w) => w.name)).toEqual(['Pengeluaran', 'Rekap']);

    const sheet = book.getWorksheet('Pengeluaran');
    let listed = 0;
    sheet?.eachRow((row, n) => {
      if (n > 1) listed += Number(row.getCell(6).value);
    });
    const rekap = book.getWorksheet('Rekap');
    const periodTotal = (() => {
      let value = 0;
      rekap?.eachRow((row) => {
        if (
          row.getCell(1).value === '2026-03 s.d. 2026-04' &&
          row.getCell(2).value === 'Semua cabang'
        ) {
          value = Number(row.getCell(8).value);
        }
      });
      return value;
    })();
    const r = await report(s.headersA, 'outlet_scope=all&month_from=2026-03&month_to=2026-04');
    expect(listed).toBe(r.total.total.expense_total);
    expect(periodTotal).toBe(r.total.total.expense_total);
    expect(listed).toBe(50_000 + 30_000 + 5_000);
  });
});
