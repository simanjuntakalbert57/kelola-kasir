import type { OutletSettings, TransactionCreate } from '@kelola-kasir/contracts';
import { get, type Db } from '../db/types';
import type { ReceiptData } from './layout';
import { storeFromSettings } from './layout';

interface Row {
  employee_name: string;
  method: string;
  status: string;
  cash_tendered: number | null;
  cash_change: number | null;
  sync_state: string;
  body: string;
}

export interface ReceiptContext {
  settings: OutletSettings | null;
  outletName: string;
  timeZone: string;
}

/**
 * Builds a receipt from SQLite and the cached store settings only, so it prints with no network
 * (TDD §2.6). Returns `null` when this device has no such transaction (made on another device).
 */
export async function loadLocalReceipt(
  db: Db,
  transactionId: string,
  ctx: ReceiptContext,
  reprint = false,
): Promise<ReceiptData | null> {
  const row = await get<Row>(
    db,
    `SELECT employee_name, method, status, cash_tendered, cash_change, sync_state, body
     FROM transactions WHERE id = ?`,
    [transactionId],
  );
  if (!row) return null;
  const tx = JSON.parse(row.body) as TransactionCreate;
  return {
    store: storeFromSettings(ctx.settings, ctx.outletName),
    number: tx.number,
    createdAt: tx.client_created_at,
    timeZone: ctx.timeZone,
    cashierName: row.employee_name,
    customerLabel: tx.customer_label ?? null,
    items: tx.items.map((i) => ({
      name: i.product_name,
      quantity: i.quantity,
      unitPrice: i.unit_price,
      lineTotal: i.line_total,
    })),
    subtotal: tx.subtotal,
    discount: tx.discount_amount ?? 0,
    tax: tx.tax_amount ?? 0,
    total: tx.total,
    method: row.method === 'qris' ? 'qris' : 'cash',
    cashTendered: row.cash_tendered,
    change: row.cash_change,
    status: row.status,
    reprint,
    pendingSync: row.sync_state === 'pending',
  };
}
