import type { TransactionDto } from './serialize.js';

const WIDTH = 32;

const WIB_OFFSET_MS = 7 * 60 * 60 * 1000;

const rp = (n: number): string => `Rp${n.toLocaleString('id-ID')}`;

function twoColumns(left: string, right: string): string {
  const room = WIDTH - right.length - 1;
  const l = left.length > room ? `${left.slice(0, Math.max(room - 1, 0))}.` : left;
  return `${l}${' '.repeat(Math.max(WIDTH - l.length - right.length, 1))}${right}`;
}

function center(text: string): string {
  return text.length >= WIDTH
    ? text
    : `${' '.repeat(Math.floor((WIDTH - text.length) / 2))}${text}`;
}

function wrap(text: string): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split(/\r?\n/)) {
    let line = '';
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      if (word.length > WIDTH) {
        if (line) lines.push(line);
        for (let i = 0; i < word.length; i += WIDTH) lines.push(word.slice(i, i + WIDTH));
        line = '';
      } else if (!line) line = word;
      else if (line.length + 1 + word.length <= WIDTH) line += ` ${word}`;
      else {
        lines.push(line);
        line = word;
      }
    }
    lines.push(line);
  }
  return lines;
}

export interface ReceiptStore {
  name: string;
  address: string | null;
  phone: string | null;
  header: string | null;
  footer: string | null;
}

/** Plain-text 58 mm receipt (32 characters per line), for WhatsApp sharing and as ESC/POS source. */
export function formatReceipt(
  store: ReceiptStore,
  cashierName: string,
  tx: TransactionDto,
): string {
  const lines: string[] = [];
  const bar = '-'.repeat(WIDTH);
  for (const l of wrap(store.name)) lines.push(center(l));
  if (store.address) for (const l of wrap(store.address)) lines.push(center(l));
  if (store.phone) lines.push(center(store.phone));
  if (store.header) for (const l of wrap(store.header)) lines.push(center(l));
  lines.push(bar);

  const when = new Date(new Date(tx.client_created_at).getTime() + WIB_OFFSET_MS)
    .toISOString()
    .replace('T', ' ')
    .slice(0, 16);
  lines.push(tx.number, `${when} WIB`, `Kasir: ${cashierName}`);
  if (tx.customer_label) lines.push(`Pembeli: ${tx.customer_label}`);
  lines.push(bar);

  for (const item of tx.items) {
    for (const l of wrap(item.product_name)) lines.push(l);
    lines.push(twoColumns(`  ${item.quantity} x ${rp(item.unit_price)}`, rp(item.line_total)));
    if (item.note) lines.push(`  ${item.note}`.slice(0, WIDTH));
  }
  lines.push(bar);
  lines.push(twoColumns('Subtotal', rp(tx.subtotal)));
  if (tx.discount_amount > 0) lines.push(twoColumns('Diskon', `-${rp(tx.discount_amount)}`));
  if (tx.tax_amount > 0) lines.push(twoColumns('Pajak', rp(tx.tax_amount)));
  lines.push(twoColumns('TOTAL', rp(tx.total)));

  const payment = tx.payments[0];
  if (payment) {
    lines.push(twoColumns('Bayar', payment.method === 'cash' ? 'Tunai' : 'QRIS'));
    if (payment.method === 'cash' && payment.cash_tendered !== null) {
      lines.push(twoColumns('Tunai', rp(payment.cash_tendered)));
      lines.push(twoColumns('Kembali', rp(payment.cash_change ?? 0)));
    }
  }
  if (tx.status !== 'paid') lines.push(center(`STATUS: ${tx.status.toUpperCase()}`));
  lines.push(bar);
  if (store.footer) for (const l of wrap(store.footer)) lines.push(center(l));
  return lines.join('\n');
}
