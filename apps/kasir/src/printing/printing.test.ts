import { describe, expect, it, vi } from 'vitest';
import { encodeLines, encodeReceipt, FEED_LINES } from './escpos';
import {
  buildReceiptLines,
  COLS,
  formatDateTime,
  money,
  receiptText,
  row,
  shortNumber,
  toPrintable,
  wrap,
  type ReceiptData,
} from './layout';
import {
  createPrintService,
  type PermissionResult,
  type PrinterDevice,
  type PrinterTransport,
} from './service';

const RECEIPT: ReceiptData = {
  store: {
    name: 'Jus Albert',
    address: 'Jl. Mawar No. 5, Medan',
    phone: '0812-3456-7890',
    header: 'Buka tiap hari 08.00-21.00',
    footer: 'Terima kasih, selamat menikmati!\nIG @jusalbert',
  },
  number: 'JUS1-K01-261026-0042',
  createdAt: '2026-10-26T07:32:00Z', // 14:32 WIB
  timeZone: 'Asia/Jakarta',
  cashierName: 'Sari',
  items: [
    { name: 'Jus Alpukat', quantity: 1, unitPrice: 18000, lineTotal: 18000 },
    { name: 'Jus Jeruk', quantity: 2, unitPrice: 12000, lineTotal: 24000 },
  ],
  subtotal: 42000,
  discount: 0,
  tax: 0,
  total: 42000,
  method: 'cash',
  cashTendered: 100000,
  change: 58000,
  status: 'paid',
};

describe('receipt layout (32 columns)', () => {
  it('formats money and dates for the outlet timezone', () => {
    expect(money(42000)).toBe('42.000');
    expect(money(1250000)).toBe('1.250.000');
    expect(money(-5000)).toBe('-5.000');
    expect(formatDateTime('2026-10-26T07:32:00Z', 'Asia/Jakarta')).toBe('26 Okt 2026 14:32');
    expect(shortNumber('JUS1-K01-261026-0042')).toBe('#0042');
  });

  it('right-aligns amounts and never exceeds 32 columns', () => {
    expect(row('TOTAL', '42.000')).toHaveLength(COLS);
    expect(row('TOTAL', '42.000').endsWith('42.000')).toBe(true);
    const long = row('Jus Alpukat Spesial Tanpa Gula Extra', '18.000');
    expect(long).toHaveLength(COLS);
    expect(long.endsWith(' 18.000')).toBe(true);
    for (const l of buildReceiptLines(RECEIPT)) expect(l.text.length).toBeLessThanOrEqual(COLS);
  });

  it('wraps long item names with an indent and splits oversized words', () => {
    const lines = wrap('2x Jus Alpukat Kocok Susu Coklat Spesial Tanpa Es', COLS, 3);
    expect(lines.length).toBeGreaterThan(1);
    expect(lines.every((l) => l.length <= COLS)).toBe(true);
    expect(lines[1]?.startsWith('   ')).toBe(true);
    expect(wrap('A'.repeat(70)).map((l) => l.length)).toEqual([32, 32, 6]);
  });

  it('renders header, items, totals, cash change and footer from the store settings', () => {
    const text = receiptText(RECEIPT);
    expect(text).toContain('JUS ALBERT');
    expect(text).toContain('Jl. Mawar No. 5, Medan');
    expect(text).toContain('Buka tiap hari 08.00-21.00');
    expect(text).toContain('No JUS1-K01-261026-0042');
    expect(text).toContain('26 Okt 2026 14:32');
    expect(text).toContain('Kasir: Sari');
    expect(text).toContain('1x Jus Alpukat');
    expect(text).toMatch(/@12\.000 +24\.000/);
    expect(text).toMatch(/TOTAL +42\.000/);
    expect(text).toMatch(/Cash +100\.000/);
    expect(text).toMatch(/Kembali +58\.000/);
    expect(text).toContain('IG @jusalbert');
    expect(text).not.toContain('CETAK ULANG');
  });

  it('wraps long cashier and customer lines instead of cutting them', () => {
    const lines = buildReceiptLines({
      ...RECEIPT,
      cashierName: 'Siti Nurhaliza Binti Abdullah Rahman',
      customerLabel: 'Meja 12 dekat jendela belakang',
    }).map((l) => l.text);
    expect(lines.join(' ')).toContain('Rahman');
    expect(lines.join(' ')).toContain('belakang');
    expect(lines.every((l) => l.length <= COLS)).toBe(true);
  });

  it('marks reprints, voids and unsynced receipts', () => {
    expect(receiptText({ ...RECEIPT, reprint: true })).toContain('*** CETAK ULANG ***');
    expect(receiptText({ ...RECEIPT, status: 'void_requested' })).toContain('MENUNGGU VOID');
    expect(receiptText({ ...RECEIPT, pendingSync: true })).toContain('(menunggu sinkron)');
  });

  it('prints QRIS without cash lines and skips empty header/footer', () => {
    const text = receiptText({
      ...RECEIPT,
      method: 'qris',
      store: { name: 'Toko' },
    });
    expect(text).toMatch(/QRIS +42\.000/);
    expect(text).not.toContain('Kembali');
  });

  it('transliterates characters the printer code page cannot print', () => {
    expect(toPrintable('2 × Jus · Mangga – “enak” é…')).toBe('2 x Jus - Mangga - "enak" e...');
    expect(toPrintable('Jus 🍹 Jeruk')).toBe('Jus  Jeruk');
  });
});

describe('ESC/POS encoding', () => {
  it('starts with ESC @, ends with feed lines and no cut command', () => {
    const bytes = encodeReceipt(RECEIPT);
    expect([...bytes.slice(0, 2)]).toEqual([0x1b, 0x40]);
    expect([...bytes.slice(-3)]).toEqual([0x1b, 0x64, FEED_LINES]);
    for (let i = 0; i < bytes.length - 1; i++) {
      expect(bytes[i] === 0x1d && bytes[i + 1] === 0x56).toBe(false); // GS V (cut)
    }
  });

  it('emits only ASCII text bytes and switches alignment/bold around lines', () => {
    const bytes = encodeLines([
      { text: 'TOTAL 2 × 5', align: 'center', bold: true },
      { text: 'kiri' },
    ]);
    const hex = Buffer.from(bytes).toString('hex');
    expect(hex).toContain('1b6101'); // center
    expect(hex).toContain('1b4501'); // bold on
    expect(hex).toContain('1b6100'); // back to left
    expect(Buffer.from(bytes).toString('latin1')).toContain('TOTAL 2 x 5');
    expect(bytes.every((b) => b < 0x80)).toBe(true);
  });
});

function fakeTransport(over: Partial<PrinterTransport> = {}) {
  const writes: Uint8Array[] = [];
  const transport: PrinterTransport = {
    requestPermissions: () => Promise.resolve<PermissionResult>('granted'),
    isEnabled: () => Promise.resolve(true),
    listBonded: () => Promise.resolve<PrinterDevice[]>([]),
    discover: () => Promise.resolve(),
    cancelDiscovery: () => Promise.resolve(),
    pair: () => Promise.resolve(),
    connect: vi.fn(() => Promise.resolve()),
    isConnected: () => Promise.resolve(false),
    disconnect: () => Promise.resolve(),
    write: (_a, data) => {
      writes.push(Uint8Array.from(data));
      return Promise.resolve();
    },
    onDisconnected: () => () => undefined,
    openSettings: () => undefined,
    ...over,
  };
  return { transport, writes };
}

const instant = { sleep: () => Promise.resolve() };

describe('print service (printer faults never throw)', () => {
  it('reconnects once and writes the whole receipt in small chunks', async () => {
    const { transport, writes } = fakeTransport();
    const service = createPrintService(transport, { chunkSize: 64, ...instant });
    const res = await service.printReceipt('AA:BB', RECEIPT);
    expect(res).toEqual({ ok: true });
    expect(transport.connect).toHaveBeenCalledTimes(1);
    expect(writes.length).toBeGreaterThan(1);
    expect(writes.every((w) => w.length <= 64)).toBe(true);
    const joined = Buffer.concat(writes);
    expect(joined.equals(Buffer.from(encodeReceipt(RECEIPT)))).toBe(true);
  });

  it('reuses a live connection', async () => {
    const { transport } = fakeTransport({ isConnected: () => Promise.resolve(true) });
    await createPrintService(transport, instant).printReceipt('AA:BB', RECEIPT);
    expect(transport.connect).not.toHaveBeenCalled();
  });

  it.each([
    ['no printer saved', null, {}, 'no_printer'],
    ['Bluetooth off', 'AA', { isEnabled: () => Promise.resolve(false) }, 'bluetooth_off'],
    [
      'permission denied',
      'AA',
      { requestPermissions: () => Promise.resolve<PermissionResult>('denied') },
      'permission',
    ],
    [
      'printer unreachable',
      'AA',
      { connect: () => Promise.reject(new Error('x')) },
      'not_connected',
    ],
    [
      'link breaks mid-print',
      'AA',
      { write: () => Promise.reject(new Error('broken pipe')) },
      'write_failed',
    ],
  ] as const)('reports %s as %s without throwing', async (_name, address, over, reason) => {
    const { transport } = fakeTransport(over);
    const res = await createPrintService(transport, instant).printReceipt(address, RECEIPT);
    expect(res).toMatchObject({ ok: false, reason });
    if (!res.ok) expect(res.message.length).toBeGreaterThan(5);
  });

  it('prints a test page', async () => {
    const { transport, writes } = fakeTransport();
    expect(await createPrintService(transport, instant).printTestPage('AA')).toEqual({ ok: true });
    expect(Buffer.concat(writes).toString('latin1')).toContain('TES PRINTER');
  });
});
