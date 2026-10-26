import type { TransactionSummary } from '@kelola-kasir/contracts';
import type { Db } from '../db/types';
import { localDay } from './number';

export type HistoryScope = 'shift' | 'today';
export type MethodFilter = 'all' | 'cash' | 'qris';
export type SyncBadge = 'pending' | 'synced' | 'rejected';

export interface HistoryRow {
  id: string;
  number: string;
  createdAt: string;
  method: 'cash' | 'qris';
  status: string;
  total: number;
  itemCount: number;
  employeeName: string;
  sync: SyncBadge;
  /** Stored on this device (`false` = made on another device, read from the server). */
  local: boolean;
}

interface Row {
  id: string;
  number: string;
  created_at: string;
  method: string;
  status: string;
  total: number;
  employee_name: string;
  sync_state: string;
  items: number;
}

const toBadge = (s: string): SyncBadge => (s === 'pending' || s === 'rejected' ? s : 'synced');

/** This device's transactions for the open shift or for today (outlet timezone), newest first. */
export async function listLocalHistory(
  db: Db,
  q: { scope: HistoryScope; shiftId: string; timeZone: string; now?: Date },
): Promise<HistoryRow[]> {
  const now = q.now ?? new Date();
  const base = `SELECT t.id, t.number, t.created_at, t.method, t.status, t.total, t.employee_name,
      t.sync_state, (SELECT COALESCE(SUM(quantity), 0) FROM transaction_items i
                     WHERE i.transaction_id = t.id) AS items
    FROM transactions t`;
  let rows: Row[];
  if (q.scope === 'shift') {
    rows = await db.all<Row>(`${base} WHERE t.shift_id = ? ORDER BY t.created_at DESC`, [
      q.shiftId,
    ]);
  } else {
    // 36 h covers any outlet timezone's "today"; the exact day is checked below.
    const since = new Date(now.getTime() - 36 * 3600 * 1000).toISOString();
    const today = localDay(now, q.timeZone);
    rows = (
      await db.all<Row>(`${base} WHERE t.created_at >= ? ORDER BY t.created_at DESC`, [since])
    ).filter((r) => localDay(new Date(r.created_at), q.timeZone) === today);
  }
  return rows.map((r) => ({
    id: r.id,
    number: r.number,
    createdAt: r.created_at,
    method: r.method === 'qris' ? 'qris' : 'cash',
    status: r.status,
    total: r.total,
    itemCount: r.items,
    employeeName: r.employee_name,
    sync: toBadge(r.sync_state),
    local: true,
  }));
}

/**
 * Adds what the server knows: transactions from the outlet's other devices, and status changes
 * (void approved on the dashboard). Rows still waiting in the outbox keep their local status.
 */
export function mergeRemote(
  local: readonly HistoryRow[],
  remote: readonly TransactionSummary[],
): HistoryRow[] {
  const byId = new Map(local.map((r) => [r.id, r]));
  for (const t of remote) {
    const mine = byId.get(t.id);
    if (mine) {
      if (mine.sync === 'synced') byId.set(t.id, { ...mine, status: t.status });
    } else {
      byId.set(t.id, {
        id: t.id,
        number: t.number,
        createdAt: t.client_created_at,
        method: t.payment_method,
        status: t.status,
        total: t.total,
        itemCount: t.item_count ?? 0,
        employeeName: t.employee.name,
        sync: 'synced',
        local: false,
      });
    }
  }
  return [...byId.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function filterByMethod(rows: readonly HistoryRow[], method: MethodFilter): HistoryRow[] {
  return method === 'all' ? [...rows] : rows.filter((r) => r.method === method);
}

/** Keeps the local copy in step with server-side status changes, so offline history stays right. */
export async function storeRemoteStatuses(
  db: Db,
  remote: readonly TransactionSummary[],
): Promise<void> {
  await db.transaction(async (tx) => {
    for (const t of remote) {
      await tx.run(
        "UPDATE transactions SET status = ? WHERE id = ? AND sync_state = 'synced' AND status <> ?",
        [t.status, t.id, t.status],
      );
    }
  });
}

export const STATUS_LABEL: Record<string, string> = {
  paid: 'Lunas',
  pending: 'Menunggu bayar',
  void_requested: 'Menunggu void',
  voided: 'Dibatalkan (void)',
  cancelled: 'Dibatalkan',
};

/** Reprint is offered in every status but "Dibatalkan" (design K-10). */
export const canReprint = (status: string): boolean => status !== 'cancelled';
