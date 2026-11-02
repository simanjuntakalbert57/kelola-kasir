import { asc, desc, eq, inArray, sql } from 'drizzle-orm';
import type { DbOrTx } from '../../db/client.js';
import {
  payments,
  transactionDeletions,
  transactionItems,
  transactions,
  users,
  voidRequests,
} from '../../db/schema.js';
import { isoOrNull } from '../../lib/time.js';
import { loadEmployees } from '../shifts/summary.js';
import { toPayment } from '../payments/serialize.js';
import { loadSettings } from '../settings/serialize.js';

export type TransactionRow = typeof transactions.$inferSelect;
type VoidRequestRow = typeof voidRequests.$inferSelect;

export type TransactionStatus = 'pending' | 'paid' | 'void_requested' | 'voided' | 'cancelled';

function summaryOf(
  row: TransactionRow,
  employee: Awaited<ReturnType<typeof loadEmployees>> extends Map<string, infer E> ? E : never,
  itemCount: number,
) {
  return {
    id: row.id,
    number: row.number,
    status: row.status as TransactionStatus,
    payment_method: row.paymentMethod as 'cash' | 'qris',
    total: row.total,
    item_count: itemCount,
    customer_label: row.customerLabel,
    employee,
    shift_id: row.shiftId,
    price_mismatch: row.priceMismatch,
    after_shift_close: row.afterShiftClose,
    client_created_at: row.clientCreatedAt.toISOString(),
    paid_at: isoOrNull(row.paidAt),
  };
}

export type TransactionSummaryDto = ReturnType<typeof summaryOf>;

export async function toTransactionSummaries(
  db: DbOrTx,
  rows: TransactionRow[],
): Promise<TransactionSummaryDto[]> {
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);
  const [people, counts] = await Promise.all([
    loadEmployees(db, [...new Set(rows.map((r) => r.employeeId))]),
    db
      .select({
        transactionId: transactionItems.transactionId,
        n: sql<number>`coalesce(sum(${transactionItems.quantity}), 0)::int`,
      })
      .from(transactionItems)
      .where(inArray(transactionItems.transactionId, ids))
      .groupBy(transactionItems.transactionId),
  ]);
  const itemCounts = new Map(counts.map((c) => [c.transactionId, c.n]));
  return rows.map((row) => {
    const employee = people.get(row.employeeId);
    if (!employee) throw new Error(`employee ${row.employeeId} missing`);
    return summaryOf(row, employee, itemCounts.get(row.id) ?? 0);
  });
}

export async function toVoidRequest(
  db: DbOrTx,
  row: VoidRequestRow,
  transaction: Pick<TransactionRow, 'number' | 'total'>,
) {
  const people = await loadEmployees(db, [row.requestedBy]);
  const requestedBy = people.get(row.requestedBy);
  if (!requestedBy) throw new Error(`employee ${row.requestedBy} missing`);
  return {
    id: row.id,
    transaction_id: row.transactionId,
    transaction_number: transaction.number,
    transaction_total: transaction.total,
    reason: row.reason,
    status: row.status as 'pending' | 'approved' | 'rejected',
    requested_by: requestedBy,
    requested_at: row.requestedAt.toISOString(),
    decided_by: row.decidedBy,
    decision_channel: row.decisionChannel as 'dashboard' | 'device_pin' | null,
    decision_note: row.decisionNote,
    decided_at: isoOrNull(row.decidedAt),
  };
}

/** Owner-only view of the delete state; employees and devices never see a deleted transaction. */
export interface OwnerView {
  ownerView?: boolean;
}

const userRef = (id: string, names: Map<string, string>) => ({ id, name: names.get(id) ?? '-' });

async function loadUserNames(db: DbOrTx, ids: string[]): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  const rows = await db
    .select({ id: users.id, name: users.name })
    .from(users)
    .where(inArray(users.id, ids));
  return new Map(rows.map((u) => [u.id, u.name]));
}

/** `deleted` (+ `deletion_history` for the owner) per transaction id (ADR-0019). */
export async function loadDeletionState(db: DbOrTx, rows: TransactionRow[], withHistory: boolean) {
  const events = withHistory
    ? await db
        .select()
        .from(transactionDeletions)
        .where(
          inArray(
            transactionDeletions.transactionId,
            rows.map((r) => r.id),
          ),
        )
        .orderBy(asc(transactionDeletions.createdAt), asc(transactionDeletions.id))
    : [];
  const names = await loadUserNames(db, [
    ...new Set([
      ...rows.flatMap((r) => (r.deletedBy ? [r.deletedBy] : [])),
      ...events.map((e) => e.actorUserId),
    ]),
  ]);
  return new Map(
    rows.map((row) => [
      row.id,
      {
        deleted:
          row.deletedAt && row.deletedBy && row.deleteReason
            ? {
                deleted_at: row.deletedAt.toISOString(),
                deleted_by: userRef(row.deletedBy, names),
                reason: row.deleteReason,
              }
            : null,
        history: events
          .filter((e) => e.transactionId === row.id)
          .map((e) => ({
            id: e.id,
            action: e.action as 'delete' | 'restore',
            reason: e.reason,
            actor: userRef(e.actorUserId, names),
            created_at: e.createdAt.toISOString(),
          })),
      },
    ]),
  );
}

/** Full transaction (items, payments, latest void request) for the given rows. */
export async function toTransactionDetails(
  db: DbOrTx,
  rows: TransactionRow[],
  { ownerView = false }: OwnerView = {},
) {
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);
  const summaries = await toTransactionSummaries(db, rows);
  const [deletion, items, pays, voids] = await Promise.all([
    ownerView ? loadDeletionState(db, rows, true) : undefined,
    db.select().from(transactionItems).where(inArray(transactionItems.transactionId, ids)),
    db.select().from(payments).where(inArray(payments.transactionId, ids)),
    db
      .select()
      .from(voidRequests)
      .where(inArray(voidRequests.transactionId, ids))
      .orderBy(desc(voidRequests.requestedAt)),
  ]);

  // The static QRIS image is shown as a fallback next to the payload.
  let qrImageUrl: string | null = null;
  if (pays.some((p) => p.method === 'qris' && p.provider === 'qris_static')) {
    const outletId = rows[0]?.outletId;
    if (outletId) qrImageUrl = (await loadSettings(db, outletId)).settings.qrisStaticImageUrl;
  }

  return Promise.all(
    rows.map(async (row, index) => {
      const summary = summaries[index];
      if (!summary) throw new Error('summary missing');
      const latestVoid = voids.find((v) => v.transactionId === row.id);
      const state = deletion?.get(row.id);
      return {
        ...summary,
        subtotal: row.subtotal,
        discount_amount: row.discountAmount,
        tax_amount: row.taxAmount,
        items: items
          .filter((i) => i.transactionId === row.id)
          .map((i) => ({
            id: i.id,
            product_id: i.productId,
            product_name: i.productName,
            unit_price: i.unitPrice,
            quantity: i.quantity,
            line_total: i.lineTotal,
            note: i.note,
          })),
        payments: pays
          .filter((p) => p.transactionId === row.id)
          .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
          .map((p) => toPayment(p, qrImageUrl)),
        void_request: latestVoid ? await toVoidRequest(db, latestVoid, row) : null,
        server_received_at: row.serverReceivedAt.toISOString(),
        deleted: state?.deleted ?? null,
        ...(state ? { deletion_history: state.history } : {}),
      };
    }),
  );
}

export type TransactionDto = Awaited<ReturnType<typeof toTransactionDetails>>[number];

export async function loadTransactionDto(
  db: DbOrTx,
  transactionId: string,
  view: OwnerView = {},
): Promise<TransactionDto | undefined> {
  const [row] = await db
    .select()
    .from(transactions)
    .where(eq(transactions.id, transactionId))
    .limit(1);
  if (!row) return undefined;
  const [dto] = await toTransactionDetails(db, [row], view);
  return dto;
}
