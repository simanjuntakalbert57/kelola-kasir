import type { Shift, ShiftSummary } from '@kelola-kasir/contracts';
import { ApiError, NetworkError, type ApiClient } from '../api/client';
import { get, type Db } from '../db/types';
import { enqueueMutation, pendingCount } from '../sync/outbox';

/** Totals as the closing screen shows them (same fields as the server's `ShiftSummary`). */
export interface ShiftTotals {
  openingCash: number;
  cashSales: number;
  qrisSales: number;
  transactionCount: number;
  expectedCash: number;
  pendingVoidCount: number;
  pendingVoidAmount: number;
  voidedCount: number;
  voidedAmount: number;
}

interface Row {
  method: string;
  status: string;
  n: number;
  amount: number;
}

/**
 * Totals from this device's own transactions. Used offline (and as the figure shown before the
 * server confirms): other devices' sales are not in it, hence the warning on the screen.
 * Mirrors the server: cash/QRIS sales count `paid` + `void_requested`; expected = opening + cash.
 */
export async function localShiftTotals(
  db: Db,
  shift: Pick<Shift, 'id' | 'opening_cash'>,
): Promise<ShiftTotals> {
  const rows = await db.all<Row>(
    `SELECT method, status, COUNT(*) AS n, COALESCE(SUM(total), 0) AS amount
     FROM transactions WHERE shift_id = ? GROUP BY method, status`,
    [shift.id],
  );
  const sum = (pick: (r: Row) => boolean, field: 'n' | 'amount') =>
    rows.filter(pick).reduce((acc, r) => acc + r[field], 0);
  const counted = (r: Row) => r.status === 'paid' || r.status === 'void_requested';
  const cashSales = sum((r) => counted(r) && r.method === 'cash', 'amount');
  const qrisSales = sum((r) => counted(r) && r.method === 'qris', 'amount');
  return {
    openingCash: shift.opening_cash,
    cashSales,
    qrisSales,
    transactionCount: sum(counted, 'n'),
    expectedCash: shift.opening_cash + cashSales,
    pendingVoidCount: sum((r) => r.status === 'void_requested', 'n'),
    pendingVoidAmount: sum((r) => r.status === 'void_requested', 'amount'),
    voidedCount: sum((r) => r.status === 'voided', 'n'),
    voidedAmount: sum((r) => r.status === 'voided', 'amount'),
  };
}

export function totalsFromSummary(s: ShiftSummary): ShiftTotals {
  return {
    openingCash: s.shift.opening_cash,
    cashSales: s.total_cash_sales,
    qrisSales: s.total_qris_sales,
    transactionCount: s.transaction_count,
    expectedCash: s.expected_cash,
    pendingVoidCount: s.pending_void_count,
    pendingVoidAmount: s.pending_void_amount,
    voidedCount: s.voided_count,
    voidedAmount: s.voided_amount,
  };
}

/** Actual − expected: negative = short, positive = over. */
export const cashDifference = (actual: number, expected: number): number => actual - expected;

/** A note is mandatory whenever the counted cash differs from the expected cash (design K-11). */
export const noteRequired = (difference: number): boolean => difference !== 0;

export type CloseOutcome =
  | { mode: 'online'; totals: ShiftTotals; summary: ShiftSummary }
  | { mode: 'queued'; totals: ShiftTotals; unsynced: number };

export interface CloseInput {
  shift: Pick<Shift, 'id' | 'opening_cash'>;
  employeeId: string;
  actualCash: number;
  note?: string;
  /** The cashier accepted the strong offline warning. Required to queue instead of closing online. */
  allowOffline: boolean;
  now?: Date;
}

export class OfflineCloseNotConfirmed extends Error {
  override readonly name = 'OfflineCloseNotConfirmed';
  constructor(readonly unsynced: number) {
    super('Offline close needs confirmation');
  }
}

/**
 * Closes the shift (M-13). Online with nothing queued: `POST /shifts/{id}/close`, the server's
 * summary is final. Offline (or while sales are still queued): queue `shift.close` behind them in
 * the outbox with `closed_offline=true` once the cashier confirmed the warning; the server
 * recomputes the summary when it applies the mutation.
 * `PENDING_QRIS_EXISTS` / other API errors propagate so the screen can explain them.
 */
export async function closeShift(
  deps: { api: Pick<ApiClient, 'closeShift'>; db: Db },
  input: CloseInput,
): Promise<CloseOutcome> {
  const { api, db } = deps;
  const now = input.now ?? new Date();
  const note = input.note?.trim();
  const closedAt = now.toISOString();
  const unsynced = await pendingCount(db);
  const totals = await localShiftTotals(db, input.shift);

  if (unsynced === 0) {
    try {
      const summary = await api.closeShift(input.shift.id, {
        actual_cash: input.actualCash,
        closed_at: closedAt,
        ...(note ? { closing_note: note } : {}),
      });
      return { mode: 'online', totals: totalsFromSummary(summary), summary };
    } catch (error) {
      const unreachable =
        error instanceof NetworkError || (error instanceof ApiError && error.status >= 500);
      if (!unreachable) throw error;
    }
  }

  if (!input.allowOffline) throw new OfflineCloseNotConfirmed(unsynced);
  await db.transaction((tx) =>
    enqueueMutation(tx, {
      id: input.shift.id,
      type: 'shift.close',
      employeeId: input.employeeId,
      clientCreatedAt: closedAt,
      payload: {
        shift_id: input.shift.id,
        actual_cash: input.actualCash,
        closed_at: closedAt,
        ...(note ? { closing_note: note } : {}),
        closed_offline: true,
        unsynced_count: unsynced,
      },
    }),
  );
  return { mode: 'queued', totals, unsynced };
}

/** A `shift.close` still queued means this device already closed the shift (offline). */
export async function hasUnsyncedClose(db: Db, shiftId: string): Promise<boolean> {
  const row = await get<{ n: number }>(
    db,
    "SELECT COUNT(*) AS n FROM outbox WHERE type = 'shift.close' AND id = ? AND state = 'pending'",
    [shiftId],
  );
  return (row?.n ?? 0) > 0;
}
