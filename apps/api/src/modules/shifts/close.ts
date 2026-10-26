import { and, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { AppContext, EmployeePrincipal } from '../../context.js';
import { shifts, transactions } from '../../db/schema.js';
import { errors } from '../../errors.js';
import { isoTimestamp } from '../../lib/validate.js';
import { writeAudit } from '../audit/audit.js';
import { computeShiftTotals, type ShiftRow } from './summary.js';

/** Largest tolerated device clock drift (TDD §2.4). */
export const MAX_CLOCK_SKEW_MS = 10 * 60 * 1000;

export const closeBodySchema = z.object({
  actual_cash: z.number().int().min(0).max(1_000_000_000_000),
  closed_at: isoTimestamp,
  closing_note: z.string().max(500).optional(),
  closed_offline: z.boolean().default(false),
  unsynced_count: z.number().int().min(0).optional(),
});

export type CloseBody = z.output<typeof closeBodySchema>;

export interface Closer {
  employeeId: string;
  deviceId: string;
  outletId: string;
}

export const closerOf = (principal: EmployeePrincipal): Closer => ({
  employeeId: principal.id,
  deviceId: principal.deviceId,
  outletId: principal.outletId,
});

/**
 * Close the outlet's shift and freeze its totals (TDD §2.5). Used by `POST /shifts/{id}/close` and
 * by the `shift.close` sync mutation. Closing twice with the same data is an idempotent replay.
 */
export async function closeShift(
  ctx: AppContext,
  closer: Closer,
  shiftId: string,
  body: CloseBody,
  ip: string | undefined,
): Promise<{ shift: ShiftRow; replayed: boolean }> {
  const now = ctx.now();
  if (body.closed_at.getTime() > now.getTime() + MAX_CLOCK_SKEW_MS) {
    throw errors.validation([{ path: 'closed_at', message: 'closed_at is in the future' }]);
  }
  return ctx.db.transaction(async (tx) => {
    const [shift] = await tx
      .select()
      .from(shifts)
      .where(and(eq(shifts.id, shiftId), eq(shifts.outletId, closer.outletId)))
      .for('update');
    if (!shift) throw errors.notFound('Shift not found');

    if (shift.status === 'closed') {
      const replay =
        shift.closedBy === closer.employeeId &&
        shift.actualCash === body.actual_cash &&
        shift.closedAt?.getTime() === body.closed_at.getTime();
      if (replay) return { shift, replayed: true };
      throw errors.conflict(
        'SHIFT_CLOSED',
        'Shift already closed',
        'This shift has already been closed',
      );
    }
    if (body.closed_at < shift.openedAt) {
      throw errors.validation([
        { path: 'closed_at', message: 'closed_at is before the shift opened' },
      ]);
    }

    const [pending] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(transactions)
      .where(and(eq(transactions.shiftId, shiftId), eq(transactions.status, 'pending')));
    if ((pending?.n ?? 0) > 0) {
      throw errors.conflict(
        'PENDING_QRIS_EXISTS',
        'Pending QRIS payments exist',
        `${pending?.n} QRIS payment(s) are still pending; confirm or cancel them first`,
      );
    }

    // Sales created after the close time are kept, but reported separately as late.
    await tx
      .update(transactions)
      .set({ afterShiftClose: true })
      .where(
        and(
          eq(transactions.shiftId, shiftId),
          sql`${transactions.clientCreatedAt} > ${body.closed_at.toISOString()}::timestamptz`,
        ),
      );
    const totals = await computeShiftTotals(tx, shift, body.closed_at);
    const difference = body.actual_cash - totals.expectedCash;
    const [updated] = await tx
      .update(shifts)
      .set({
        status: 'closed',
        closedAt: body.closed_at,
        closedBy: closer.employeeId,
        closedDeviceId: closer.deviceId,
        closingNote: body.closing_note ?? null,
        closedOffline: body.closed_offline,
        unsyncedCount: body.unsynced_count ?? null,
        actualCash: body.actual_cash,
        expectedCash: totals.expectedCash,
        cashDifference: difference,
        totalCashSales: totals.totalCashSales,
        totalQrisSales: totals.totalQrisSales,
        transactionCount: totals.transactionCount,
      })
      .where(eq(shifts.id, shiftId))
      .returning();
    if (!updated) throw errors.notFound('Shift not found');

    await writeAudit(tx, {
      outletId: closer.outletId,
      actor: { type: 'employee', id: closer.employeeId },
      action: body.closed_offline ? 'shift.closed_offline' : 'shift.closed',
      entityType: 'shift',
      entityId: shiftId,
      after: {
        expected_cash: totals.expectedCash,
        actual_cash: body.actual_cash,
        cash_difference: difference,
        unsynced_count: body.unsynced_count ?? null,
      },
      meta: { ip, device_id: closer.deviceId, closed_offline: body.closed_offline },
    });
    return { shift: updated, replayed: false };
  });
}
