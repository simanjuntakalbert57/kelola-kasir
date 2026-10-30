import { and, desc, eq, gte, ilike, isNotNull, lt, or, type SQL } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import { z } from 'zod';
import type { AppContext } from '../../context.js';
import type { Database } from '../../db/client.js';
import { transactionDeletions, transactions } from '../../db/schema.js';
import { errors } from '../../errors.js';
import { endOfBusinessDay, startOfBusinessDay } from '../../lib/time.js';
import { businessDate, escapeLike, uuid } from '../../lib/validate.js';
import { writeAudit } from '../audit/audit.js';
import {
  loadDeletionState,
  loadTransactionDto,
  toTransactionSummaries,
  type TransactionRow,
} from './serialize.js';

/** Owner soft delete / restore of transactions (ADR-0019). */

export const deleteInputSchema = z.object({
  reason: z.string().trim().min(5).max(200),
});

export const restoreInputSchema = z
  .object({ note: z.string().trim().max(200).optional() })
  .default({});

export const deletedListQuery = z.object({
  date_from: businessDate.optional(),
  date_to: businessDate.optional(),
  date_field: z.enum(['deleted_at', 'client_created_at']).default('deleted_at'),
  q: z.string().trim().max(60).optional(),
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

interface Actor {
  outletId: string;
  userId: string;
  ip?: string;
}

const NOT_DELETABLE = ['pending', 'void_requested'];

async function lockTransaction(
  tx: Pick<Database, 'select'>,
  outletId: string,
  id: string,
): Promise<TransactionRow> {
  const [row] = await tx
    .select()
    .from(transactions)
    .where(and(eq(transactions.id, id), eq(transactions.outletId, outletId)))
    .for('update');
  if (!row) throw errors.notFound('Transaction not found');
  return row;
}

const snapshot = (row: TransactionRow) => ({
  status: row.status,
  total: row.total,
  deleted_at: row.deletedAt?.toISOString() ?? null,
  deleted_by: row.deletedBy,
  delete_reason: row.deleteReason,
});

/** Soft delete. Row, history and audit are written in one database transaction. */
export async function deleteTransaction(ctx: AppContext, by: Actor, id: string, reason: string) {
  await ctx.db.transaction(async (tx) => {
    const row = await lockTransaction(tx, by.outletId, id);
    if (row.deletedAt) return; // idempotent: keep the first reason and history
    if (NOT_DELETABLE.includes(row.status)) {
      throw errors.conflict(
        'TRANSACTION_NOT_DELETABLE',
        'Transaction cannot be deleted',
        row.status === 'pending'
          ? 'Selesaikan pembayaran dulu sebelum menghapus transaksi'
          : 'Selesaikan keputusan void dulu sebelum menghapus transaksi',
      );
    }
    const [after] = await tx
      .update(transactions)
      .set({ deletedAt: ctx.now(), deletedBy: by.userId, deleteReason: reason })
      .where(eq(transactions.id, id))
      .returning();
    if (!after) throw errors.notFound('Transaction not found');
    // uuidv7 keeps delete/restore ordered when two rows share a timestamp.
    await tx.insert(transactionDeletions).values({
      id: uuidv7(),
      outletId: by.outletId,
      transactionId: id,
      action: 'delete',
      reason,
      actorUserId: by.userId,
      createdAt: after.deletedAt ?? ctx.now(),
    });
    await writeAudit(tx, {
      outletId: by.outletId,
      actor: { type: 'user', id: by.userId },
      action: 'transaction.deleted',
      entityType: 'transaction',
      entityId: id,
      before: snapshot(row),
      after: snapshot(after),
      meta: { number: row.number, ...(by.ip ? { ip: by.ip } : {}) },
    });
  });
  return loadOwnerDto(ctx.db, id);
}

/** Undo a delete. A transaction that is not deleted is returned unchanged. */
export async function restoreTransaction(
  ctx: AppContext,
  by: Actor,
  id: string,
  note: string | undefined,
) {
  await ctx.db.transaction(async (tx) => {
    const row = await lockTransaction(tx, by.outletId, id);
    if (!row.deletedAt) return;
    const [after] = await tx
      .update(transactions)
      .set({ deletedAt: null, deletedBy: null, deleteReason: null })
      .where(eq(transactions.id, id))
      .returning();
    if (!after) throw errors.notFound('Transaction not found');
    // uuidv7 keeps delete/restore ordered when two rows share a timestamp.
    await tx.insert(transactionDeletions).values({
      id: uuidv7(),
      outletId: by.outletId,
      transactionId: id,
      action: 'restore',
      reason: note || null,
      actorUserId: by.userId,
      createdAt: ctx.now(),
    });
    await writeAudit(tx, {
      outletId: by.outletId,
      actor: { type: 'user', id: by.userId },
      action: 'transaction.restored',
      entityType: 'transaction',
      entityId: id,
      before: snapshot(row),
      after: snapshot(after),
      meta: { number: row.number, ...(note ? { note } : {}), ...(by.ip ? { ip: by.ip } : {}) },
    });
  });
  return loadOwnerDto(ctx.db, id);
}

async function loadOwnerDto(db: Database, id: string) {
  const dto = await loadTransactionDto(db, id, { ownerView: true });
  if (!dto) throw errors.notFound('Transaction not found');
  return dto;
}

function decodeDeletedCursor(cursor: string): { t: Date; id: string } {
  try {
    const parsed = z
      .object({ t: z.iso.datetime(), id: uuid })
      .parse(JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')));
    return { t: new Date(parsed.t), id: parsed.id };
  } catch {
    throw errors.validation([{ path: 'cursor', message: 'Invalid cursor' }]);
  }
}

/** Riwayat Hapus: transactions that are deleted right now, newest deletion first. */
export async function listDeleted(
  db: Database,
  outletId: string,
  q: z.infer<typeof deletedListQuery>,
) {
  if (q.date_from && q.date_to && q.date_to < q.date_from) {
    throw errors.validation([{ path: 'date_to', message: 'date_to is before date_from' }]);
  }
  const field =
    q.date_field === 'deleted_at' ? transactions.deletedAt : transactions.clientCreatedAt;
  const conditions: SQL[] = [
    eq(transactions.outletId, outletId),
    isNotNull(transactions.deletedAt),
  ];
  if (q.date_from) conditions.push(gte(field, startOfBusinessDay(q.date_from)));
  if (q.date_to) conditions.push(lt(field, endOfBusinessDay(q.date_to)));
  if (q.q) {
    const like = `%${escapeLike(q.q)}%`;
    const match = or(ilike(transactions.number, like), ilike(transactions.customerLabel, like));
    if (match) conditions.push(match);
  }
  if (q.cursor) {
    const c = decodeDeletedCursor(q.cursor);
    const before = or(
      lt(transactions.deletedAt, c.t),
      and(eq(transactions.deletedAt, c.t), lt(transactions.id, c.id)),
    );
    if (before) conditions.push(before);
  }
  const rows = await db
    .select()
    .from(transactions)
    .where(and(...conditions))
    .orderBy(desc(transactions.deletedAt), desc(transactions.id))
    .limit(q.limit + 1);
  const page = rows.slice(0, q.limit);
  const last = page[page.length - 1];
  const [summaries, state] = await Promise.all([
    toTransactionSummaries(db, page),
    loadDeletionState(db, page, false),
  ]);
  return {
    data: summaries.map((s) => {
      const deleted = state.get(s.id)?.deleted;
      if (!deleted) throw new Error('deleted state missing');
      return { ...s, deleted };
    }),
    next_cursor:
      rows.length > q.limit && last?.deletedAt
        ? Buffer.from(JSON.stringify({ t: last.deletedAt.toISOString(), id: last.id })).toString(
            'base64url',
          )
        : null,
  };
}
