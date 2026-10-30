import { describe, expect, it } from 'vitest';
import {
  formatClock,
  formatRupiah,
  renderBatch,
  renderTest,
  renderTransaction,
  renderVoidApproved,
  renderVoidRequested,
} from './messages.js';

const now = new Date('2026-10-30T07:40:00Z');
const at = new Date('2026-10-30T07:32:10Z'); // 14.32 WIB
const base = {
  transactionId: 'tid',
  number: 'JUS1-K01-261030-0123',
  total: 45_000,
  method: 'qris',
  itemCount: 3,
  cashierName: 'Rina',
  at,
  timeZone: 'Asia/Jakarta',
};

describe('formatting', () => {
  it('formats rupiah and clock per zone', () => {
    expect(formatRupiah(45_000)).toBe('Rp45.000');
    expect(formatRupiah(1_312_000)).toBe('Rp1.312.000');
    expect(formatRupiah(0)).toBe('Rp0');
    expect(formatClock(at, 'Asia/Jakarta')).toBe('14.32 WIB');
    expect(formatClock(at, 'Asia/Makassar')).toBe('15.32 WITA');
    expect(formatClock(at, 'Asia/Jayapura')).toBe('16.32 WIT');
    expect(formatClock(at, 'Europe/Paris')).toBe('14.32 WIB');
  });
});

describe('renderers', () => {
  it('trx.single', () => {
    const p = renderTransaction(base, false, now);
    expect(p).toMatchObject({
      v: 1,
      kind: 'trx.single',
      title: '💰 Transaksi masuk Rp45.000',
      body: 'QRIS · 3 item · Kasir Rina\n14.32 WIB · #JUS1-K01-261030-0123',
      tag: 'trx-tid',
      url: '/transaksi?date_from=2026-10-30&date_to=2026-10-30',
      ts: now.toISOString(),
    });
  });

  it('trx.offline in a WITA outlet', () => {
    const p = renderTransaction({ ...base, timeZone: 'Asia/Makassar', method: 'cash' }, true, now);
    expect(p.kind).toBe('trx.offline');
    expect(p.title).toBe('💰 Transaksi masuk Rp45.000 · offline');
    expect(p.body).toBe('Cash · 3 item · Kasir Rina\nDibuat 15.32 WITA · #JUS1-K01-261030-0123');
  });

  it('trx.batch drops a zero method and abbreviates cashiers', () => {
    const input = {
      entityId: 'eid',
      count: 5,
      total: 312_000,
      cashCount: 3,
      qrisCount: 2,
      cashierNames: ['Rina'],
      syncedAt: at,
      timeZone: 'Asia/Jakarta',
    };
    expect(renderBatch(input, now).body).toBe(
      'Total Rp312.000 · Cash 3 · QRIS 2\nKasir Rina · disinkronkan 14.32 WIB',
    );
    const zero = renderBatch(
      { ...input, qrisCount: 0, cashierNames: ['Rina', 'Dito', 'Ayu', 'Budi'] },
      now,
    );
    expect(zero.body).toBe(
      'Total Rp312.000 · Cash 3\nKasir Rina, Dito +2 lainnya · disinkronkan 14.32 WIB',
    );
    expect(zero.title).toBe('📦 5 transaksi dari mode offline');
    expect(zero).toMatchObject({ kind: 'trx.batch', tag: 'batch-eid', url: '/transaksi' });
    expect(renderBatch({ ...input, cashCount: 0 }, now).body.split('\n')[0]).toBe(
      'Total Rp312.000 · QRIS 2',
    );
  });

  it('void.requested and void.approved share a tag', () => {
    const input = {
      entityId: 'vid',
      number: 'N1',
      total: 45_000,
      method: 'qris',
      personName: 'Rina',
      at,
      transactionAt: at,
      timeZone: 'Asia/Jakarta',
    };
    const requested = renderVoidRequested(input, now);
    expect(requested.title).toBe('⚠️ Pembatalan diajukan');
    expect(requested.body).toBe('#N1 · Rp45.000 · QRIS\nOleh Kasir Rina · 14.32 WIB');
    expect(requested.url).toBe('/void');
    const approved = renderVoidApproved({ ...input, personName: 'Pak Albert' }, now);
    expect(approved.title).toBe('⚠️ Transaksi dibatalkan');
    expect(approved.body).toBe('#N1 · Rp45.000 · QRIS\nDisetujui Pak Albert · 14.32 WIB');
    expect(approved.tag).toBe(requested.tag);
    expect(approved.url).toBe('/transaksi?date_from=2026-10-30&date_to=2026-10-30');
  });

  it('test and size limit', () => {
    const t = renderTest('sid', now);
    expect(t.tag).toBe('test-sid');
    expect(t.url).toBe('/pengaturan/notifikasi');
    const long = renderTransaction({ ...base, cashierName: 'K'.repeat(60) }, true, now);
    expect(JSON.stringify(long).length).toBeLessThan(1024);
  });
});
