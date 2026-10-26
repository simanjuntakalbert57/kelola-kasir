import { and, eq } from 'drizzle-orm';
import ExcelJS from 'exceljs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { auditLogs, transactions } from '../src/db/schema.js';
import { csvCell, csvStream, wibTimestamp } from '../src/modules/transactions/export.js';
import {
  bearer,
  createShop,
  createTestEnv,
  get,
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

const owner = (shop: Shop) => bearer(shop.ownerToken);

async function seed(shop: Shop, total: number, at: string, o: { status?: 'paid' | 'voided' } = {}) {
  return seedTransaction(env, {
    shiftId: shop.shiftId,
    outletId: shop.seeded.outletId,
    deviceId: shop.cashier.deviceId,
    employeeId: shop.cashier.employeeId,
    total,
    createdAt: new Date(at),
    ...o,
  });
}

const parseCsv = (body: string): string[][] =>
  body
    .replace(/^\uFEFF/, '')
    .trim()
    .split('\r\n')
    .map((line) => line.split(','));

describe('GET /transactions/export', () => {
  it('streams a CSV with a BOM, one row per transaction in WIB', async () => {
    const shop = await createShop(env);
    await seed(shop, 15_000, '2026-03-10T03:30:00Z');
    await seed(shop, 20_000, '2026-03-10T17:30:00Z'); // 00:30 WIB on the 11th
    const res = await get(env, '/v1/transactions/export?format=csv', owner(shop));
    expect(res.statusCode, res.body).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.headers['content-disposition']).toMatch(/attachment; filename="transaksi-.*\.csv"/);
    expect(res.body.startsWith('\uFEFF')).toBe(true);
    const rows = parseCsv(res.body);
    expect(rows[0]).toEqual([
      'Nomor',
      'Waktu (WIB)',
      'Kasir',
      'Status',
      'Metode',
      'Pelanggan',
      'Jumlah item',
      'Subtotal',
      'Diskon',
      'Pajak',
      'Total',
    ]);
    expect(rows).toHaveLength(3);
    expect(rows[1]?.slice(1)).toEqual([
      '2026-03-10 10:30:00',
      'Siti',
      'Lunas',
      'Tunai',
      '',
      '1',
      '15000',
      '0',
      '0',
      '15000',
    ]);
    expect(rows[2]?.[1]).toBe('2026-03-11 00:30:00');
  });

  it('filters by WIB business date, status and payment method', async () => {
    const shop = await createShop(env);
    await seed(shop, 15_000, '2026-03-10T03:30:00Z');
    await seed(shop, 9_000, '2026-03-10T04:30:00Z', { status: 'voided' });
    await seed(shop, 20_000, '2026-03-10T17:30:00Z');
    const day = parseCsv(
      (
        await get(
          env,
          '/v1/transactions/export?format=csv&date_from=2026-03-10&date_to=2026-03-10',
          owner(shop),
        )
      ).body,
    );
    expect(day.map((r) => r[10])).toEqual(['Total', '15000', '9000']);
    const voided = parseCsv(
      (await get(env, '/v1/transactions/export?format=csv&status=voided', owner(shop))).body,
    );
    expect(voided.map((r) => r[3])).toEqual(['Status', 'Void']);
    const qris = parseCsv(
      (await get(env, '/v1/transactions/export?format=csv&payment_method=qris', owner(shop))).body,
    );
    expect(qris).toHaveLength(1);
  });

  it('exports one row per item with detail=true', async () => {
    const shop = await createShop(env);
    const body = txBody(env, shop, { qty: 3 });
    expect((await post(env, '/v1/transactions', shop.cashier.headers, body)).statusCode).toBe(201);
    const res = await get(env, '/v1/transactions/export?format=csv&detail=true', owner(shop));
    const rows = parseCsv(res.body);
    expect(rows[0]?.slice(6)).toEqual(['Produk', 'Qty', 'Harga satuan', 'Total baris', 'Catatan']);
    expect(rows[1]?.slice(6)).toEqual(['Jus Alpukat', '3', '15000', '45000', '']);
    expect(res.headers['content-disposition']).toContain('transaksi-detail-');
  });

  it('exports an XLSX workbook that opens with the same rows', async () => {
    const shop = await createShop(env);
    await seed(shop, 15_000, '2026-03-10T03:30:00Z');
    await seed(shop, 25_000, '2026-03-10T04:30:00Z');
    const res = await get(env, '/v1/transactions/export?format=xlsx', owner(shop));
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('spreadsheetml.sheet');
    const book = new ExcelJS.Workbook();
    await book.xlsx.load(res.rawPayload as unknown as ArrayBuffer);
    const sheet = book.getWorksheet('Transaksi');
    expect(sheet?.rowCount).toBe(3);
    expect(sheet?.getRow(1).getCell(1).value).toBe('Nomor');
    expect(sheet?.getRow(2).getCell(11).value).toBe(15_000);
    expect(sheet?.getRow(3).getCell(11).value).toBe(25_000);
  });

  it('crosses batch boundaries without dropping or repeating a row', async () => {
    const shop = await createShop(env);
    for (let i = 0; i < 7; i++) await seed(shop, 1_000 + i, `2026-03-10T03:0${i}:00Z`);
    // Two rows share the same instant: the keyset tie-break on id must keep both.
    await seed(shop, 5_000, '2026-03-10T03:03:00Z');
    const chunks: string[] = [];
    const stream = csvStream(env.handle.db, {
      outletId: shop.seeded.outletId,
      detail: false,
      batchSize: 3,
    });
    for await (const chunk of stream) chunks.push(String(chunk));
    const rows = parseCsv(chunks.join(''));
    expect(rows).toHaveLength(9);
    expect(new Set(rows.slice(1).map((r) => r[0])).size).toBe(8);
  });

  it('neutralises spreadsheet formulas and quotes special characters', async () => {
    expect(csvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csvCell('+62812')).toBe("'+62812");
    expect(csvCell('Budi, Jus')).toBe('"Budi, Jus"');
    expect(csvCell(null)).toBe('');
    expect(csvCell(42)).toBe('42');
    expect(wibTimestamp(new Date('2026-03-10T17:30:00Z'))).toBe('2026-03-11 00:30:00');
  });

  it('is owner only, validates its query and is audited', async () => {
    const shop = await createShop(env);
    expect(
      (await get(env, '/v1/transactions/export?format=csv', shop.cashier.headers)).statusCode,
    ).toBe(403);
    expect((await get(env, '/v1/transactions/export?format=csv', {})).statusCode).toBe(401);
    expect((await get(env, '/v1/transactions/export', owner(shop))).statusCode).toBe(400);
    expect((await get(env, '/v1/transactions/export?format=pdf', owner(shop))).statusCode).toBe(
      400,
    );
    expect(
      (
        await get(
          env,
          '/v1/transactions/export?format=csv&date_from=2026-03-11&date_to=2026-03-10',
          owner(shop),
        )
      ).statusCode,
    ).toBe(400);
    await get(env, '/v1/transactions/export?format=csv', owner(shop));
    const logs = await env.handle.db
      .select()
      .from(auditLogs)
      .where(
        and(
          eq(auditLogs.outletId, shop.seeded.outletId),
          eq(auditLogs.action, 'transactions.exported'),
        ),
      );
    expect(logs).toHaveLength(1);
  });

  it('never leaks another outlet', async () => {
    const a = await createShop(env);
    const b = await createShop(env);
    await seed(a, 15_000, '2026-03-10T03:30:00Z');
    const rows = parseCsv((await get(env, '/v1/transactions/export?format=csv', owner(b))).body);
    expect(rows).toHaveLength(1);
    const own = await env.handle.db
      .select({ id: transactions.id })
      .from(transactions)
      .where(eq(transactions.outletId, a.seeded.outletId));
    expect(own).toHaveLength(1);
  });
});
