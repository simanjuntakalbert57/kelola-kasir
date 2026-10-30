/**
 * Final notification copy (design DEAR-100 §A.3, ADR-0017 §8). Pure functions: no I/O.
 * Never put customer labels, PINs, tokens, void reasons or payment references in a payload.
 */
export type NotificationKind =
  'trx.single' | 'trx.offline' | 'trx.batch' | 'void.requested' | 'void.approved' | 'test';

export interface PushPayload {
  v: 1;
  kind: NotificationKind;
  title: string;
  body: string;
  tag: string;
  url: string;
  ts: string;
}

const ZONE_LABELS: Record<string, string> = {
  'Asia/Jakarta': 'WIB',
  'Asia/Pontianak': 'WIB',
  'Asia/Makassar': 'WITA',
  'Asia/Jayapura': 'WIT',
};

/** `Rp45.000` */
export const formatRupiah = (amount: number): string =>
  `Rp${Math.round(amount)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, '.')}`;

/** `14.32 WIB` in the outlet's time zone. */
export function formatClock(at: Date, timeZone: string): string {
  const safeZone = ZONE_LABELS[timeZone] ? timeZone : 'Asia/Jakarta';
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: safeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(at);
  const get = (type: string): string => parts.find((p) => p.type === type)?.value ?? '00';
  return `${get('hour')}.${get('minute')} ${ZONE_LABELS[safeZone]}`;
}

/** Business date (WIB, the zone the transactions list filters by) as `yyyy-mm-dd`. */
const businessDate = (at: Date): string =>
  new Date(at.getTime() + 7 * 60 * 60 * 1000).toISOString().slice(0, 10);

const methodLabel = (method: string): string => (method === 'qris' ? 'QRIS' : 'Cash');

const listUrl = (at: Date): string => {
  const d = businessDate(at);
  return `/transaksi?date_from=${d}&date_to=${d}`;
};

export interface TransactionMessageInput {
  transactionId: string;
  number: string;
  total: number;
  method: string;
  itemCount: number;
  cashierName: string;
  /** Paid time for online sales, creation time on the cashier device for offline ones. */
  at: Date;
  timeZone: string;
}

export function renderTransaction(
  input: TransactionMessageInput,
  offline: boolean,
  now: Date,
): PushPayload {
  const clock = formatClock(input.at, input.timeZone);
  return {
    v: 1,
    kind: offline ? 'trx.offline' : 'trx.single',
    title: `💰 Transaksi masuk ${formatRupiah(input.total)}${offline ? ' · offline' : ''}`,
    body:
      `${methodLabel(input.method)} · ${input.itemCount} item · Kasir ${input.cashierName}\n` +
      `${offline ? 'Dibuat ' : ''}${clock} · #${input.number}`,
    tag: `trx-${input.transactionId}`,
    url: listUrl(input.at),
    ts: now.toISOString(),
  };
}

export interface BatchMessageInput {
  /** Smallest transaction id of the batch. */
  entityId: string;
  count: number;
  total: number;
  cashCount: number;
  qrisCount: number;
  cashierNames: string[];
  syncedAt: Date;
  timeZone: string;
}

export function renderBatch(input: BatchMessageInput, now: Date): PushPayload {
  const methods = [
    input.cashCount > 0 ? `Cash ${input.cashCount}` : null,
    input.qrisCount > 0 ? `QRIS ${input.qrisCount}` : null,
  ].filter((part): part is string => part !== null);
  const shown = input.cashierNames.slice(0, 2).join(', ');
  const rest = input.cashierNames.length - 2;
  const cashiers = `Kasir ${shown}${rest > 0 ? ` +${rest} lainnya` : ''}`;
  return {
    v: 1,
    kind: 'trx.batch',
    title: `📦 ${input.count} transaksi dari mode offline`,
    body:
      `${['Total ' + formatRupiah(input.total), ...methods].join(' · ')}\n` +
      `${cashiers} · disinkronkan ${formatClock(input.syncedAt, input.timeZone)}`,
    tag: `batch-${input.entityId}`,
    url: '/transaksi',
    ts: now.toISOString(),
  };
}

export interface VoidMessageInput {
  /** `void_requests.id`, or the transaction id for an owner void without a request. */
  entityId: string;
  number: string;
  total: number;
  method: string;
  /** Cashier name (requested) or approver name (approved). */
  personName: string;
  at: Date;
  /** Transaction date, for the link of approved voids. */
  transactionAt: Date;
  timeZone: string;
}

export function renderVoidRequested(input: VoidMessageInput, now: Date): PushPayload {
  return {
    v: 1,
    kind: 'void.requested',
    title: '⚠️ Pembatalan diajukan',
    body:
      `#${input.number} · ${formatRupiah(input.total)} · ${methodLabel(input.method)}\n` +
      `Oleh Kasir ${input.personName} · ${formatClock(input.at, input.timeZone)}`,
    tag: `void-${input.entityId}`,
    url: '/void',
    ts: now.toISOString(),
  };
}

export function renderVoidApproved(input: VoidMessageInput, now: Date): PushPayload {
  return {
    v: 1,
    kind: 'void.approved',
    title: '⚠️ Transaksi dibatalkan',
    body:
      `#${input.number} · ${formatRupiah(input.total)} · ${methodLabel(input.method)}\n` +
      `Disetujui ${input.personName} · ${formatClock(input.at, input.timeZone)}`,
    tag: `void-${input.entityId}`,
    url: listUrl(input.transactionAt),
    ts: now.toISOString(),
  };
}

export function renderTest(subscriptionId: string, now: Date): PushPayload {
  return {
    v: 1,
    kind: 'test',
    title: '🔔 Notifikasi uji',
    body: 'Kalau Anda melihat ini, notifikasi Kelola Kasir di browser ini sudah aktif.',
    tag: `test-${subscriptionId}`,
    url: '/pengaturan/notifikasi',
    ts: now.toISOString(),
  };
}
