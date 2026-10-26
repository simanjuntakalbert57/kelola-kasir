import { and, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import type { AppContext } from '../../context.js';
import { isUniqueViolation } from '../../db/client.js';
import {
  employees,
  payments,
  products,
  shifts,
  transactionItems,
  transactions,
} from '../../db/schema.js';
import { errors } from '../../errors.js';
import { writeAudit } from '../audit/audit.js';
import { resolveProvider } from '../payments/provider.js';
import { loadSettings } from '../settings/serialize.js';
import { computeShiftTotals } from '../shifts/summary.js';
import { loadTransactionDto, type TransactionDto } from './serialize.js';

export const MAX_CLOCK_SKEW_MS = 10 * 60 * 1000;
const NUMBER_PATTERN = /^[A-Z0-9]{2,6}-[A-Z0-9]{3}-[0-9]{6}-[0-9]{4}$/;

const rupiah = z.number().int().min(0).max(1_000_000_000_000);
const isoDate = z.iso.datetime({ offset: true }).transform((v) => new Date(v));

export const transactionCreateSchema = z.object({
  id: z.uuid(),
  shift_id: z.uuid(),
  number: z.string().regex(NUMBER_PATTERN, 'Invalid transaction number'),
  client_created_at: isoDate,
  customer_label: z.string().trim().max(40).optional(),
  items: z
    .array(
      z.object({
        id: z.uuid(),
        product_id: z.uuid(),
        product_name: z.string().trim().min(1).max(100),
        unit_price: rupiah,
        quantity: z.number().int().min(1).max(999),
        note: z.string().trim().max(140).optional(),
        line_total: rupiah,
      }),
    )
    .min(1)
    .max(100),
  subtotal: rupiah,
  discount_amount: rupiah.default(0),
  tax_amount: rupiah.default(0),
  total: rupiah,
  payment: z.discriminatedUnion('method', [
    z.object({ id: z.uuid(), method: z.literal('cash'), cash_tendered: rupiah }),
    z.object({ id: z.uuid(), method: z.literal('qris') }),
  ]),
});

export type TransactionCreateInput = z.output<typeof transactionCreateSchema>;

export interface CreateActor {
  outletId: string;
  device: { id: string; code: string };
  employeeId: string;
  /** `api` = online request, `sync` = replayed from the offline outbox. */
  source: 'api' | 'sync';
  ip?: string;
}

export interface CreateResult {
  transaction: TransactionDto;
  /** False when the id already existed (idempotent replay). */
  created: boolean;
}

const totalMismatch = (detail: string) =>
  errors.unprocessable('TOTAL_MISMATCH', 'Totals do not match', detail);

/** The server never trusts client math (TDD §3.2): recompute everything from the snapshot. */
export function assertTotals(input: TransactionCreateInput): void {
  let subtotal = 0;
  const seen = new Set<string>();
  for (const item of input.items) {
    if (seen.has(item.id)) {
      throw errors.validation([{ path: 'items', message: 'Duplicate item id' }]);
    }
    seen.add(item.id);
    if (item.line_total !== item.unit_price * item.quantity) {
      throw totalMismatch(`line_total of "${item.product_name}" must equal unit_price * quantity`);
    }
    subtotal += item.line_total;
  }
  if (input.subtotal !== subtotal) {
    throw totalMismatch(`subtotal must equal the sum of the lines (${subtotal})`);
  }
  if (input.discount_amount > subtotal) {
    throw totalMismatch('discount_amount cannot exceed the subtotal');
  }
  const total = subtotal - input.discount_amount + input.tax_amount;
  if (input.total !== total) {
    throw totalMismatch(`total must equal subtotal - discount_amount + tax_amount (${total})`);
  }
}

export async function createTransaction(
  ctx: AppContext,
  input: TransactionCreateInput,
  actor: CreateActor,
): Promise<CreateResult> {
  const { db } = ctx;
  assertTotals(input);
  const now = ctx.now();

  const replay = async (): Promise<CreateResult | undefined> => {
    const [existing] = await db
      .select({ outletId: transactions.outletId })
      .from(transactions)
      .where(eq(transactions.id, input.id))
      .limit(1);
    if (!existing) return undefined;
    if (existing.outletId !== actor.outletId) {
      throw errors.conflict('ID_CONFLICT', 'Identifier already in use');
    }
    const transaction = await loadTransactionDto(db, input.id);
    return transaction ? { transaction, created: false } : undefined;
  };
  const already = await replay();
  if (already) return already;

  try {
    const id = await db.transaction(async (tx) => {
      const { outlet, settings } = await loadSettings(tx, actor.outletId);
      const prefix = `${outlet.code}-${actor.device.code}-`;
      if (!input.number.startsWith(prefix)) {
        throw errors.validation([
          { path: 'number', message: `Number must start with ${prefix} (outlet and device code)` },
        ]);
      }

      const [employee] = await tx
        .select({ id: employees.id })
        .from(employees)
        .where(and(eq(employees.id, actor.employeeId), eq(employees.outletId, actor.outletId)))
        .limit(1);
      if (!employee) {
        throw errors.unprocessable('EMPLOYEE_UNKNOWN', 'Unknown employee', 'Employee not found');
      }

      // `FOR SHARE` makes a concurrent shift close wait for us (and vice versa).
      const [shift] = await tx
        .select()
        .from(shifts)
        .where(and(eq(shifts.id, input.shift_id), eq(shifts.outletId, actor.outletId)))
        .for('share');
      if (!shift) {
        throw errors.conflict('SHIFT_NOT_OPEN', 'Shift does not exist', 'Unknown shift id');
      }
      let afterShiftClose = false;
      if (shift.status === 'closed') {
        if (actor.source === 'api') {
          throw errors.conflict(
            'SHIFT_CLOSED',
            'Shift already closed',
            'Open a new shift before selling',
          );
        }
        // Real sales are never dropped: late offline sales are accepted and flagged.
        afterShiftClose = Boolean(shift.closedAt && input.client_created_at > shift.closedAt);
      }

      // Products: unknown ids are rejected; unavailable or re-priced ones are flagged on sync.
      const productIds = [...new Set(input.items.map((i) => i.product_id))];
      const catalog = await tx
        .select()
        .from(products)
        .where(and(eq(products.outletId, actor.outletId), inArray(products.id, productIds)));
      const byId = new Map(catalog.map((p) => [p.id, p]));
      const unavailable: string[] = [];
      const mismatches: { product_id: string; catalog_price: number; snapshot_price: number }[] =
        [];
      for (const item of input.items) {
        const product = byId.get(item.product_id);
        if (!product) {
          throw errors.unprocessable(
            'PRODUCT_UNAVAILABLE',
            'Product unavailable',
            `Product "${item.product_name}" does not exist`,
          );
        }
        if (product.deletedAt || !product.isActive || product.isSoldOut) {
          unavailable.push(item.product_name);
        }
        if (product.price !== item.unit_price) {
          mismatches.push({
            product_id: product.id,
            catalog_price: product.price,
            snapshot_price: item.unit_price,
          });
        }
      }
      if (unavailable.length > 0 && actor.source === 'api') {
        throw errors.unprocessable(
          'PRODUCT_UNAVAILABLE',
          'Product unavailable',
          `Not available for sale: ${[...new Set(unavailable)].join(', ')}`,
        );
      }

      const isCash = input.payment.method === 'cash';
      let status: 'paid' | 'pending';
      let paymentValues: typeof payments.$inferInsert;
      if (input.payment.method === 'cash') {
        if (input.payment.cash_tendered < input.total) {
          throw errors.unprocessable(
            'CASH_INSUFFICIENT',
            'Cash is not enough',
            `cash_tendered must be at least ${input.total}`,
          );
        }
        status = 'paid';
        paymentValues = {
          id: input.payment.id,
          transactionId: input.id,
          method: 'cash',
          provider: 'cash',
          status: 'paid',
          amount: input.total,
          cashTendered: input.payment.cash_tendered,
          cashChange: input.payment.cash_tendered - input.total,
          paidAt: input.client_created_at,
          createdAt: now,
        };
      } else {
        if (actor.source === 'sync') {
          throw errors.unprocessable(
            'QRIS_NOT_SYNCABLE',
            'QRIS cannot be synced',
            'QRIS payments are online only (ADR-0003)',
          );
        }
        if (input.total <= 0) {
          throw errors.validation([{ path: 'total', message: 'QRIS needs a positive total' }]);
        }
        const provider = resolveProvider(settings);
        const charge = await provider.createCharge({
          paymentId: input.payment.id,
          transactionNumber: input.number,
          amount: input.total,
          expiresInSec: ctx.config.qrisExpirySec,
          now,
        });
        status = 'pending';
        paymentValues = {
          id: input.payment.id,
          transactionId: input.id,
          method: 'qris',
          provider: provider.name,
          status: 'pending',
          amount: input.total,
          providerRef: charge.providerRef ?? null,
          qrPayload: charge.qrPayload,
          expiresAt: charge.expiresAt,
          confirmationMode: provider.confirmationMode,
          createdAt: now,
        };
      }

      await tx.insert(transactions).values({
        id: input.id,
        outletId: actor.outletId,
        shiftId: input.shift_id,
        deviceId: actor.device.id,
        employeeId: actor.employeeId,
        number: input.number,
        status,
        paymentMethod: input.payment.method,
        customerLabel: input.customer_label ?? null,
        subtotal: input.subtotal,
        discountAmount: input.discount_amount,
        taxAmount: input.tax_amount,
        total: input.total,
        priceMismatch: mismatches.length > 0,
        afterShiftClose,
        clientCreatedAt: input.client_created_at,
        serverReceivedAt: now,
        paidAt: isCash ? input.client_created_at : null,
      });
      await tx.insert(transactionItems).values(
        input.items.map((item) => ({
          id: item.id,
          transactionId: input.id,
          productId: item.product_id,
          productName: item.product_name,
          unitPrice: item.unit_price,
          quantity: item.quantity,
          lineTotal: item.line_total,
          note: item.note ?? null,
        })),
      );
      await tx.insert(payments).values(paymentValues);

      const auditBase = {
        outletId: actor.outletId,
        actor: { type: 'employee' as const, id: actor.employeeId },
        entityType: 'transaction',
        entityId: input.id,
      };
      const meta = {
        number: input.number,
        source: actor.source,
        device_id: actor.device.id,
        ...(actor.ip ? { ip: actor.ip } : {}),
      };
      if (mismatches.length > 0) {
        await writeAudit(tx, {
          ...auditBase,
          action: 'sync.price_mismatch',
          after: { items: mismatches },
          meta,
        });
      }
      if (unavailable.length > 0) {
        await writeAudit(tx, {
          ...auditBase,
          action: 'sync.product_unavailable',
          after: { products: [...new Set(unavailable)] },
          meta,
        });
      }
      const skew = input.client_created_at.getTime() - now.getTime();
      // Offline sales arrive late by design, so only a device clock running ahead is suspicious there.
      if (skew > MAX_CLOCK_SKEW_MS || (actor.source === 'api' && -skew > MAX_CLOCK_SKEW_MS)) {
        await writeAudit(tx, {
          ...auditBase,
          action: 'transaction.clock_skew',
          after: { skew_ms: skew },
          meta,
        });
      }

      // A sale made before the close that only arrives now still belongs to the closed shift.
      if (shift.status === 'closed' && !afterShiftClose && shift.actualCash !== null) {
        const totals = await computeShiftTotals(tx, shift, shift.closedAt);
        await tx
          .update(shifts)
          .set({
            expectedCash: totals.expectedCash,
            cashDifference: shift.actualCash - totals.expectedCash,
            totalCashSales: totals.totalCashSales,
            totalQrisSales: totals.totalQrisSales,
            transactionCount: totals.transactionCount,
          })
          .where(eq(shifts.id, shift.id));
        await writeAudit(tx, {
          ...auditBase,
          entityType: 'shift',
          entityId: shift.id,
          action: 'shift.totals_recomputed',
          before: { expected_cash: shift.expectedCash },
          after: { expected_cash: totals.expectedCash },
          meta: { reason: 'late_transaction', transaction_id: input.id },
        });
      }
      return input.id;
    });
    const transaction = await loadTransactionDto(db, id);
    if (!transaction) throw new Error('transaction vanished after insert');
    return { transaction, created: true };
  } catch (err) {
    if (isUniqueViolation(err, 'transactions_pkey')) {
      const again = await replay();
      if (again) return again;
    }
    if (isUniqueViolation(err, 'transactions_outlet_number_unique')) {
      throw errors.conflict(
        'NUMBER_CONFLICT',
        'Transaction number already used',
        'Another transaction already has this number; continue the numbering from the latest one',
      );
    }
    if (isUniqueViolation(err)) {
      throw errors.conflict('ID_CONFLICT', 'Identifier already in use');
    }
    throw err;
  }
}
