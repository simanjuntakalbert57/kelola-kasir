import { and, eq } from 'drizzle-orm';
import type { Principal } from '../../context.js';
import type { Database, DbOrTx } from '../../db/client.js';
import { shifts, transactions } from '../../db/schema.js';
import { errors } from '../../errors.js';
import type { TransactionRow } from './serialize.js';

/** Business date (WIB) of an instant, as `yyyy-mm-dd`. */
export const wibDate = (at: Date): string =>
  new Date(at.getTime() + 7 * 60 * 60 * 1000).toISOString().slice(0, 10);

/**
 * A transaction of the caller's outlet; one the owner deleted is `404` unless `includeDeleted` (ADR-0019). Employees only see the running shift and today's sales
 * (PRD §5); anything else is `403`, an unknown id (or another outlet's) is `404`.
 */
export async function findVisibleTransaction(
  db: Database,
  now: Date,
  principal: Principal,
  id: string,
  includeDeleted = false,
): Promise<TransactionRow> {
  const [row] = await db
    .select()
    .from(transactions)
    .where(and(eq(transactions.id, id), eq(transactions.outletId, principal.outletId)))
    .limit(1);
  if (!row || (row.deletedAt && !includeDeleted)) throw errors.notFound('Transaction not found');
  if (principal.type === 'employee') await assertEmployeeMayView(db, now, row);
  return row;
}

/** Employees only act on the running shift or today's sales (PRD §5); `now` is the moment of the action. */
export async function assertEmployeeMayView(
  db: DbOrTx,
  now: Date,
  row: Pick<TransactionRow, 'clientCreatedAt' | 'shiftId'>,
): Promise<void> {
  if (wibDate(row.clientCreatedAt) === wibDate(now)) return;
  const [shift] = await db
    .select({ status: shifts.status })
    .from(shifts)
    .where(eq(shifts.id, row.shiftId))
    .limit(1);
  if (shift?.status !== 'open') {
    throw errors.forbidden('You can only view transactions of the open shift or of today');
  }
}
