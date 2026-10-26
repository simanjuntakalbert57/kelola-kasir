import type { OutletSettings, Receipt } from '@kelola-kasir/contracts';

/** Characters per line of a 58 mm ESC/POS printer (font A), TDD §2.6. */
export const COLS = 32;

export interface ReceiptStore {
  name: string;
  address?: string | null;
  phone?: string | null;
  header?: string | null;
  footer?: string | null;
}

export interface ReceiptItem {
  name: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
}

/** Everything a receipt needs, independent of where it came from (SQLite or `GET /receipt`). */
export interface ReceiptData {
  store: ReceiptStore;
  number: string;
  createdAt: string;
  timeZone: string;
  cashierName: string;
  customerLabel?: string | null;
  items: ReceiptItem[];
  subtotal: number;
  discount: number;
  tax: number;
  total: number;
  method: 'cash' | 'qris';
  cashTendered?: number | null;
  change?: number | null;
  status: string;
  /** `*** CETAK ULANG ***` copy. */
  reprint?: boolean;
  /** Saved on this device but not yet on the server (marked on the receipt). */
  pendingSync?: boolean;
}

export interface ReceiptLine {
  text: string;
  align?: 'left' | 'center';
  bold?: boolean;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];

/** Keeps printable ASCII only: the RPP02N code page prints "×", "·" or accents as garbage. */
export function toPrintable(text: string): string {
  return text
    .replace(/[×✕]/g, 'x')
    .replace(/[·•]/g, '-')
    .replace(/[–—]/g, '-')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/…/g, '...')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\x20-\x7E]/g, '');
}

/** `42000` → `42.000` (Rupiah without the prefix: 32 columns are tight). */
export function money(n: number): string {
  const sign = n < 0 ? '-' : '';
  return sign + String(Math.abs(Math.trunc(n))).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

/** `26 Okt 2026 14:32` in the outlet's timezone. */
export function formatDateTime(iso: string, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(iso));
  const pick = (t: string) => parts.find((p) => p.type === t)?.value ?? '00';
  const month = MONTHS[Number(pick('month')) - 1] ?? pick('month');
  return `${pick('day')} ${month} ${pick('year')} ${pick('hour')}:${pick('minute')}`;
}

/** Word-wraps to `width`; lines after the first are indented by `indent`. Long words are split. */
/** `14:32` in the outlet's timezone (history rows). */
export function formatTime(iso: string, timeZone: string): string {
  return formatDateTime(iso, timeZone).slice(-5);
}

/** Short number for lists: `JUS-K01-261026-0042` → `#0042`. */
export function shortNumber(number: string): string {
  return `#${number.split('-').pop() ?? number}`;
}

export function wrap(text: string, width = COLS, indent = 0): string[] {
  const lines: string[] = [];
  let current = '';
  const room = () => width - (lines.length > 0 ? indent : 0);
  const flush = () => {
    lines.push((lines.length > 0 ? ' '.repeat(indent) : '') + current);
    current = '';
  };
  for (const word of toPrintable(text).split(/\s+/).filter(Boolean)) {
    let w = word;
    if (current && current.length + 1 + w.length <= room()) {
      current += ` ${w}`;
      continue;
    }
    if (current) flush();
    while (w.length > room()) {
      current = w.slice(0, room());
      w = w.slice(current.length);
      flush();
    }
    current = w;
  }
  if (current) flush();
  return lines;
}

/** `left` on the left, `right` flush right, one line of `width` characters. */
export function row(left: string, right: string, width = COLS): string {
  const l = toPrintable(left);
  const r = toPrintable(right);
  const room = width - r.length - 1;
  const cut = l.length > room ? l.slice(0, Math.max(0, room)) : l;
  return cut + ' '.repeat(Math.max(1, width - cut.length - r.length)) + r;
}

const STATUS_NOTE: Record<string, string> = {
  void_requested: 'MENUNGGU VOID',
  voided: 'DIVOID',
  cancelled: 'DIBATALKAN',
  pending: 'BELUM LUNAS',
};

const DASHES = '-'.repeat(COLS);

/** The receipt as aligned lines (shared by the thermal printer, the on-screen preview and WhatsApp). */
export function buildReceiptLines(r: ReceiptData): ReceiptLine[] {
  const out: ReceiptLine[] = [];
  const center = (text: string, bold = false) => {
    for (const t of wrap(text)) out.push({ text: t, align: 'center', ...(bold ? { bold } : {}) });
  };
  const left = (text: string, bold = false) =>
    out.push({ text: toPrintable(text), ...(bold ? { bold } : {}) });

  if (r.reprint) center('*** CETAK ULANG ***', true);
  center(r.store.name.toUpperCase(), true);
  if (r.store.address) center(r.store.address);
  if (r.store.phone) center(`Telp ${r.store.phone}`);
  for (const line of (r.store.header ?? '').split('\n')) if (line.trim()) center(line.trim());
  left(DASHES);
  for (const t of wrap(`No ${r.number}`)) left(t);
  left(formatDateTime(r.createdAt, r.timeZone));
  for (const t of wrap(`Kasir: ${r.cashierName}`)) left(t);
  if (r.customerLabel) for (const t of wrap(`Pelanggan: ${r.customerLabel}`)) left(t);
  left(DASHES);
  for (const item of r.items) {
    for (const t of wrap(`${item.quantity}x ${item.name}`, COLS, 3)) left(t);
    left(row(`   @${money(item.unitPrice)}`, money(item.lineTotal)));
  }
  left(DASHES);
  if (r.discount > 0 || r.tax > 0) left(row('Subtotal', money(r.subtotal)));
  if (r.discount > 0) left(row('Diskon', `-${money(r.discount)}`));
  if (r.tax > 0) left(row('Pajak', money(r.tax)));
  left(row('TOTAL', money(r.total)), true);
  if (r.method === 'cash') {
    left(row('Cash', money(r.cashTendered ?? r.total)));
    left(row('Kembali', money(r.change ?? 0)));
  } else {
    left(row('QRIS', money(r.total)));
  }
  const note = STATUS_NOTE[r.status];
  if (note) {
    left(DASHES);
    center(`*** ${note} ***`, true);
  }
  if (r.pendingSync) center('(menunggu sinkron)');
  left(DASHES);
  for (const line of (r.store.footer ?? '').split('\n')) if (line.trim()) center(line.trim());
  return out;
}

/** Plain-text receipt: on-screen preview and the WhatsApp share text. */
export function renderText(lines: readonly ReceiptLine[]): string {
  return lines
    .map((l) => {
      if (l.align !== 'center') return l.text;
      return ' '.repeat(Math.max(0, Math.floor((COLS - l.text.length) / 2))) + l.text;
    })
    .join('\n');
}

export function receiptText(r: ReceiptData): string {
  return renderText(buildReceiptLines(r));
}

export function storeFromSettings(
  settings: OutletSettings | null,
  fallbackName: string,
): ReceiptStore {
  return {
    name: settings?.display_name || fallbackName,
    address: settings?.address ?? null,
    phone: settings?.phone ?? null,
    header: settings?.receipt_header ?? null,
    footer: settings?.receipt_footer ?? null,
  };
}

/** Receipt from `GET /transactions/{id}/receipt` (transactions made on another device). */
export function receiptFromApi(api: Receipt, timeZone: string, reprint = false): ReceiptData {
  const t = api.transaction;
  const cash = t.payments.find((p) => p.method === 'cash');
  return {
    store: {
      name: api.store.name,
      address: api.store.address ?? null,
      phone: api.store.phone ?? null,
      header: api.store.header ?? null,
      footer: api.store.footer ?? null,
    },
    number: t.number,
    createdAt: t.client_created_at,
    timeZone,
    cashierName: api.cashier_name,
    customerLabel: t.customer_label ?? null,
    items: t.items.map((i) => ({
      name: i.product_name,
      quantity: i.quantity,
      unitPrice: i.unit_price,
      lineTotal: i.line_total,
    })),
    subtotal: t.subtotal,
    discount: t.discount_amount,
    tax: t.tax_amount,
    total: t.total,
    method: t.payment_method,
    cashTendered: cash?.cash_tendered ?? null,
    change: cash?.cash_change ?? null,
    status: t.status,
    reprint,
  };
}

/** Sample receipt for "Cetak tes" and the preview on the Printer screen. */
export function testPageLines(): ReceiptLine[] {
  return [
    { text: 'TES PRINTER', align: 'center', bold: true },
    { text: 'Kelola Kasir - 58 mm', align: 'center' },
    { text: row('Kolom 32', '12345678') },
    { text: '01234567890123456789012345678901' },
    { text: 'Printer siap dipakai', align: 'center' },
  ];
}
