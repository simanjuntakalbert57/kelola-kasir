import { and, eq, sql } from 'drizzle-orm';
import type { DbOrTx } from '../../db/client.js';
import { employees, payments, transactions, type shifts } from '../../db/schema.js';
import { isoOrNull } from '../../lib/time.js';
import { toEmployee, type EmployeeDto } from '../employees/serialize.js';

export type ShiftRow = typeof shifts.$inferSelect;

export interface ShiftDto {
  id: string;
  opened_on_device_id: string;
  closed_on_device_id: string | null;
  opened_by: EmployeeDto;
  closed_by: EmployeeDto | null;
  status: 'open' | 'closed';
  opening_cash: number;
  expected_cash: number | null;
  actual_cash: number | null;
  cash_difference: number | null;
  opened_at: string;
  closed_at: string | null;
  closed_offline: boolean;
}

export interface ShiftTotals {
  totalCashSales: number;
  totalQrisSales: number;
  transactionCount: number;
  expectedCash: number;
  pendingVoidCount: number;
  pendingVoidAmount: number;
  voidedCount: number;
  voidedAmount: number;
  lateCount: number;
  lateCashAmount: number;
  qrisManualConfirmedCount: number;
  byEmployee: {
    employeeId: string;
    transactionCount: number;
    totalCashSales: number;
    totalQrisSales: number;
  }[];
}

/** Sales counted in the shift: `paid`, plus `void_requested` until the owner decides (TDD §3.2). */
const COUNTED = ['paid', 'void_requested'];

/**
 * Aggregate the shift's transactions. Only transactions created at or before `cutoff` (the close
 * time, if closed) count towards the shift; later ones are "late" (synced after the shift closed)
 * and are reported separately so real sales are never lost.
 */
export async function computeShiftTotals(
  db: DbOrTx,
  shift: Pick<ShiftRow, 'id' | 'openingCash'>,
  cutoff: Date | null,
): Promise<ShiftTotals> {
  // `late` is computed in a derived table so the GROUP BY can refer to it by column.
  const lateExpr = cutoff
    ? sql`(t.client_created_at > ${cutoff.toISOString()}::timestamptz)`
    : sql`false`;
  const result = await db.execute<{
    employee_id: string;
    payment_method: string;
    status: string;
    late: boolean;
    n: number;
    amount: string;
  }>(sql`
    select employee_id, payment_method, status, late, count(*)::int as n, coalesce(sum(total), 0)::text as amount
    from (
      select t.employee_id, t.payment_method, t.status, t.total, ${lateExpr} as late
      from transactions t
      where t.shift_id = ${shift.id}
    ) x
    group by employee_id, payment_method, status, late
  `);
  const rows = result.rows.map((r) => ({
    employeeId: r.employee_id,
    method: r.payment_method,
    status: r.status,
    late: r.late,
    n: Number(r.n),
    amount: r.amount,
  }));

  const totals: ShiftTotals = {
    totalCashSales: 0,
    totalQrisSales: 0,
    transactionCount: 0,
    expectedCash: 0,
    pendingVoidCount: 0,
    pendingVoidAmount: 0,
    voidedCount: 0,
    voidedAmount: 0,
    lateCount: 0,
    lateCashAmount: 0,
    qrisManualConfirmedCount: 0,
    byEmployee: [],
  };
  const per = new Map<string, ShiftTotals['byEmployee'][number]>();

  for (const r of rows) {
    const amount = Number(r.amount);
    const counted = COUNTED.includes(r.status);
    if (r.late) {
      if (counted) {
        totals.lateCount += r.n;
        if (r.method === 'cash') totals.lateCashAmount += amount;
      }
      continue;
    }
    if (r.status === 'voided') {
      totals.voidedCount += r.n;
      totals.voidedAmount += amount;
      continue;
    }
    if (!counted) continue;
    totals.transactionCount += r.n;
    const entry = per.get(r.employeeId) ?? {
      employeeId: r.employeeId,
      transactionCount: 0,
      totalCashSales: 0,
      totalQrisSales: 0,
    };
    entry.transactionCount += r.n;
    if (r.method === 'cash') {
      totals.totalCashSales += amount;
      entry.totalCashSales += amount;
    } else {
      totals.totalQrisSales += amount;
      entry.totalQrisSales += amount;
    }
    per.set(r.employeeId, entry);
    if (r.status === 'void_requested') {
      totals.pendingVoidCount += r.n;
      totals.pendingVoidAmount += amount;
    }
  }
  totals.expectedCash = shift.openingCash + totals.totalCashSales;
  totals.byEmployee = [...per.values()];

  const [manual] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(payments)
    .innerJoin(transactions, eq(transactions.id, payments.transactionId))
    .where(
      and(
        eq(transactions.shiftId, shift.id),
        eq(payments.method, 'qris'),
        eq(payments.status, 'paid'),
        eq(payments.confirmationMode, 'manual'),
        sql`${transactions.status} IN ('paid', 'void_requested')`,
        cutoff
          ? sql`${transactions.clientCreatedAt} <= ${cutoff.toISOString()}::timestamptz`
          : sql`true`,
      ),
    );
  totals.qrisManualConfirmedCount = manual?.n ?? 0;
  return totals;
}

export async function loadEmployees(db: DbOrTx, ids: string[]): Promise<Map<string, EmployeeDto>> {
  const map = new Map<string, EmployeeDto>();
  if (ids.length === 0) return map;
  const rows = await db
    .select()
    .from(employees)
    .where(
      sql`${employees.id} IN (${sql.join(
        ids.map((id) => sql`${id}::uuid`),
        sql`, `,
      )})`,
    );
  for (const row of rows) map.set(row.id, toEmployee(row));
  return map;
}

export async function toShiftDtos(db: DbOrTx, rows: ShiftRow[]): Promise<ShiftDto[]> {
  const ids = new Set<string>();
  for (const row of rows) {
    ids.add(row.openedBy);
    if (row.closedBy) ids.add(row.closedBy);
  }
  const people = await loadEmployees(db, [...ids]);
  return rows.map((row) => {
    const openedBy = people.get(row.openedBy);
    if (!openedBy) throw new Error(`employee ${row.openedBy} missing`);
    return {
      id: row.id,
      opened_on_device_id: row.openedDeviceId,
      closed_on_device_id: row.closedDeviceId,
      opened_by: openedBy,
      closed_by: row.closedBy ? (people.get(row.closedBy) ?? null) : null,
      status: row.status as 'open' | 'closed',
      opening_cash: row.openingCash,
      expected_cash: row.expectedCash,
      actual_cash: row.actualCash,
      cash_difference: row.cashDifference,
      opened_at: row.openedAt.toISOString(),
      closed_at: isoOrNull(row.closedAt),
      closed_offline: row.closedOffline,
    };
  });
}

export async function buildShiftSummary(db: DbOrTx, shift: ShiftRow) {
  const totals = await computeShiftTotals(db, shift, shift.closedAt);
  const [dto] = await toShiftDtos(db, [shift]);
  if (!dto) throw new Error('shift dto missing');
  const people = await loadEmployees(
    db,
    totals.byEmployee.map((e) => e.employeeId),
  );
  const closed = shift.status === 'closed';
  // A closed shift keeps the totals recorded at close time (what the cashier reconciled against).
  const totalCash = closed
    ? (shift.totalCashSales ?? totals.totalCashSales)
    : totals.totalCashSales;
  const totalQris = closed
    ? (shift.totalQrisSales ?? totals.totalQrisSales)
    : totals.totalQrisSales;
  const expected = closed ? (shift.expectedCash ?? totals.expectedCash) : totals.expectedCash;

  return {
    shift: dto,
    total_cash_sales: totalCash,
    total_qris_sales: totalQris,
    qris_manual_confirmed_count: totals.qrisManualConfirmedCount,
    total_sales: totalCash + totalQris,
    transaction_count: closed
      ? (shift.transactionCount ?? totals.transactionCount)
      : totals.transactionCount,
    expected_cash: expected,
    actual_cash: shift.actualCash,
    cash_difference: shift.cashDifference,
    pending_void_count: totals.pendingVoidCount,
    pending_void_amount: totals.pendingVoidAmount,
    voided_count: totals.voidedCount,
    voided_amount: totals.voidedAmount,
    unsynced_hint: (shift.unsyncedCount ?? 0) > 0,
    late_transaction_count: totals.lateCount,
    late_cash_amount: totals.lateCashAmount,
    by_employee: totals.byEmployee.flatMap((e) => {
      const employee = people.get(e.employeeId);
      return employee
        ? [
            {
              employee,
              transaction_count: e.transactionCount,
              total_cash_sales: e.totalCashSales,
              total_qris_sales: e.totalQrisSales,
            },
          ]
        : [];
    }),
  };
}
