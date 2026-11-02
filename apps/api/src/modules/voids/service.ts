import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import type { AppContext } from '../../context.js';
import { isUniqueViolation } from '../../db/client.js';
import { employees, transactions, voidRequests } from '../../db/schema.js';
import { errors } from '../../errors.js';
import { writeAudit } from '../audit/audit.js';
import { uuid } from '../../lib/validate.js';
import { assertEmployeeMayView } from '../transactions/access.js';
import { toVoidRequest } from '../transactions/serialize.js';

export const voidReasonSchema = z.string().trim().min(3).max(300);
export const voidCreateSchema = z.object({ id: uuid.optional(), reason: voidReasonSchema });
export const voidDecisionSchema = z.object({ note: z.string().trim().max(300).optional() });

type VoidRequestDto = Awaited<ReturnType<typeof toVoidRequest>>;

export interface VoidRequester {
  outletId: string;
  employeeId: string;
  /** Device the request came from (`device_id` in the audit trail). */
  deviceId?: string;
  source: 'api' | 'sync';
  ip?: string;
}

const notVoidable = (status: string) =>
  errors.conflict(
    'TRANSACTION_NOT_VOIDABLE',
    'Transaction cannot be voided',
    `Only paid transactions can be voided (status is ${status})`,
  );

/**
 * An employee asks to void a paid transaction (P-10): `paid` → `void_requested`, a pending
 * `void_requests` row and an audit record commit together. Idempotent on the request `id`
 * (the offline outbox replays safely).
 */
export async function requestVoid(
  ctx: AppContext,
  by: VoidRequester,
  transactionId: string,
  input: { id: string; reason: string; requestedAt: Date },
): Promise<{ voidRequest: VoidRequestDto; created: boolean }> {
  const now = ctx.now();
  // A device clock running ahead must not date the request in the future.
  const requestedAt = input.requestedAt > now ? now : input.requestedAt;
  try {
    const result = await ctx.db.transaction(async (tx) => {
      const [existing] = await tx
        .select()
        .from(voidRequests)
        .where(eq(voidRequests.id, input.id))
        .limit(1);
      const [row] = await tx
        .select()
        .from(transactions)
        .where(and(eq(transactions.id, transactionId), eq(transactions.outletId, by.outletId)))
        .for('update');
      if (!row || row.deletedAt) throw errors.notFound('Transaction not found');
      const [employee] = await tx
        .select({ id: employees.id })
        .from(employees)
        .where(and(eq(employees.id, by.employeeId), eq(employees.outletId, by.outletId)))
        .limit(1);
      if (!employee) {
        throw errors.unprocessable('EMPLOYEE_UNKNOWN', 'Unknown employee', 'Employee not found');
      }
      if (existing) {
        if (existing.transactionId !== transactionId) {
          throw errors.conflict('ID_CONFLICT', 'Identifier already in use');
        }
        return { voidRequest: await toVoidRequest(tx, existing, row), created: false };
      }
      if (row.status !== 'paid') throw notVoidable(row.status);
      // The online route checks this before calling; an offline request is judged at the time the
      // employee made it, so a request queued yesterday is not lost on a closed shift of today.
      if (by.source === 'sync') await assertEmployeeMayView(tx, requestedAt, row);

      const [created] = await tx
        .insert(voidRequests)
        .values({
          id: input.id,
          transactionId,
          requestedBy: by.employeeId,
          reason: input.reason,
          status: 'pending',
          requestedAt,
        })
        .returning();
      if (!created) throw new Error('void request insert failed');
      await tx
        .update(transactions)
        .set({ status: 'void_requested' })
        .where(eq(transactions.id, transactionId));
      await writeAudit(tx, {
        outletId: by.outletId,
        actor: { type: 'employee', id: by.employeeId },
        action: 'transaction.void_requested',
        entityType: 'transaction',
        entityId: transactionId,
        before: { status: 'paid' },
        after: { status: 'void_requested', reason: input.reason },
        meta: {
          number: row.number,
          total: row.total,
          void_request_id: input.id,
          source: by.source,
          requested_at: requestedAt.toISOString(),
          ...(by.deviceId ? { device_id: by.deviceId } : {}),
          ...(by.ip ? { ip: by.ip } : {}),
        },
      });
      return { voidRequest: await toVoidRequest(tx, created, row), created: true };
    });
    if (result.created) ctx.notifier.onVoidRequested(input.id);
    return result;
  } catch (err) {
    if (isUniqueViolation(err, 'void_requests_pkey')) {
      // Two identical requests raced; the loser replays.
      const [again] = await ctx.db.select().from(voidRequests).where(eq(voidRequests.id, input.id));
      const [row] = await ctx.db
        .select()
        .from(transactions)
        .where(eq(transactions.id, transactionId));
      if (again && row && again.transactionId === transactionId) {
        return { voidRequest: await toVoidRequest(ctx.db, again, row), created: false };
      }
    }
    throw err;
  }
}

export interface VoidDecider {
  outletId: string;
  /** Owner (user) account that decides. */
  userId: string;
  channel: 'dashboard' | 'device_pin';
  /** Employee on whose device the owner PIN was entered (`device_pin` only). */
  viaEmployeeId?: string;
  deviceId?: string;
  ip?: string;
}

/** Approve (`voided`) or reject (back to `paid`) a pending void request (O-08). Idempotent per decision. */
export async function decideVoid(
  ctx: AppContext,
  by: VoidDecider,
  voidRequestId: string,
  decision: 'approve' | 'reject',
  note: string | undefined,
): Promise<VoidRequestDto> {
  const wanted = decision === 'approve' ? 'approved' : 'rejected';
  let decidedNow: { transactionId: string } | undefined;
  const dto = await ctx.db.transaction(async (tx) => {
    const [found] = await tx
      .select({ request: voidRequests, transaction: transactions })
      .from(voidRequests)
      .innerJoin(transactions, eq(transactions.id, voidRequests.transactionId))
      .where(and(eq(voidRequests.id, voidRequestId), eq(transactions.outletId, by.outletId)))
      .for('update');
    if (!found) throw errors.notFound('Void request not found');
    const { request, transaction } = found;

    if (request.status !== 'pending') {
      if (request.status === wanted) {
        return toVoidRequest(tx, request, transaction); // idempotent replay
      }
      throw errors.conflict(
        'VOID_ALREADY_DECIDED',
        'Void request already decided',
        `This request was already ${request.status}`,
      );
    }
    const now = ctx.now();
    const [updated] = await tx
      .update(voidRequests)
      .set({
        status: wanted,
        decidedBy: by.userId,
        decisionChannel: by.channel,
        decisionNote: note ?? null,
        decidedAt: now,
      })
      .where(eq(voidRequests.id, request.id))
      .returning();
    if (!updated) throw new Error('void decision update failed');
    decidedNow = { transactionId: transaction.id };
    await tx
      .update(transactions)
      .set(decision === 'approve' ? { status: 'voided', voidedAt: now } : { status: 'paid' })
      .where(and(eq(transactions.id, transaction.id), eq(transactions.status, 'void_requested')));
    await writeAudit(tx, {
      outletId: by.outletId,
      actor: { type: 'user', id: by.userId },
      action: decision === 'approve' ? 'transaction.void_approved' : 'transaction.void_rejected',
      entityType: 'transaction',
      entityId: transaction.id,
      before: { status: 'void_requested' },
      after: { status: decision === 'approve' ? 'voided' : 'paid', note: note ?? null },
      meta: {
        number: transaction.number,
        total: transaction.total,
        void_request_id: request.id,
        reason: request.reason,
        requested_by: request.requestedBy,
        requested_at: request.requestedAt.toISOString(),
        decided_at: now.toISOString(),
        channel: by.channel,
        ...(by.viaEmployeeId ? { via_employee_id: by.viaEmployeeId } : {}),
        ...(by.deviceId ? { device_id: by.deviceId } : {}),
        ...(by.ip ? { ip: by.ip } : {}),
      },
    });
    return toVoidRequest(tx, updated, transaction);
  });
  // Rejected voids are not notified; a dashboard decision is not echoed to its own author (ADR-0017 §1).
  if (decidedNow && decision === 'approve') {
    ctx.notifier.onVoidApproved({
      transactionId: decidedNow.transactionId,
      voidRequestId,
      approverUserId: by.userId,
      ...(by.channel === 'dashboard' ? { excludeUserId: by.userId } : {}),
    });
  }
  return dto;
}

/** The owner voids a paid transaction right away (no request needed). */
export async function voidDirectly(
  ctx: AppContext,
  by: { outletId: string; userId: string; ip?: string },
  transactionId: string,
  reason: string,
): Promise<void> {
  let settledRequestId: string | null | undefined;
  await ctx.db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(transactions)
      .where(and(eq(transactions.id, transactionId), eq(transactions.outletId, by.outletId)))
      .for('update');
    if (!row || row.deletedAt) throw errors.notFound('Transaction not found');
    if (row.status === 'voided') {
      // Idempotent: voiding twice is not an error, but the first void keeps its audit record.
      return;
    }
    if (row.status !== 'paid' && row.status !== 'void_requested') throw notVoidable(row.status);
    const now = ctx.now();
    await tx
      .update(transactions)
      .set({ status: 'voided', voidedAt: now })
      .where(eq(transactions.id, transactionId));
    // The owner's call settles an employee's pending request on the same transaction.
    const settled = await tx
      .update(voidRequests)
      .set({
        status: 'approved',
        decidedBy: by.userId,
        decisionChannel: 'dashboard',
        decisionNote: reason,
        decidedAt: now,
      })
      .where(and(eq(voidRequests.transactionId, transactionId), eq(voidRequests.status, 'pending')))
      .returning({ id: voidRequests.id });
    settledRequestId = settled[0]?.id ?? null;
    await writeAudit(tx, {
      outletId: by.outletId,
      actor: { type: 'user', id: by.userId },
      action: 'transaction.void_approved',
      entityType: 'transaction',
      entityId: transactionId,
      before: { status: row.status },
      after: { status: 'voided', reason },
      meta: {
        number: row.number,
        total: row.total,
        reason,
        channel: 'dashboard',
        direct: true,
        decided_at: now.toISOString(),
        ...(by.ip ? { ip: by.ip } : {}),
      },
    });
  });
  if (settledRequestId !== undefined) {
    ctx.notifier.onVoidApproved({
      transactionId,
      ...(settledRequestId ? { voidRequestId: settledRequestId } : {}),
      approverUserId: by.userId,
      excludeUserId: by.userId,
    });
  }
}
