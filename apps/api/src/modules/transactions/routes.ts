import { and, desc, eq, gte, ilike, lt, or, sql, type SQL } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext, Principal } from '../../context.js';
import { employees, shifts, transactions } from '../../db/schema.js';
import { errors } from '../../errors.js';
import { endOfBusinessDay, startOfBusinessDay } from '../../lib/time.js';
import { escapeLike, parse, uuid } from '../../lib/validate.js';
import { requireEmployee, type Guards } from '../../plugins/auth.js';
import { loadSettings } from '../settings/serialize.js';
import { formatReceipt } from './receipt.js';
import { createTransaction, transactionCreateSchema } from './service.js';
import {
  loadTransactionDto,
  toTransactionDetails,
  toTransactionSummaries,
  type TransactionRow,
} from './serialize.js';

const idParams = z.object({ transaction_id: uuid });
const listQuery = z.object({
  scope: z.enum(['shift', 'today']).default('shift'),
  date_from: z.iso.date().optional(),
  date_to: z.iso.date().optional(),
  employee_id: uuid.optional(),
  shift_id: uuid.optional(),
  payment_method: z.enum(['cash', 'qris']).optional(),
  status: z.enum(['pending', 'paid', 'void_requested', 'voided', 'cancelled']).optional(),
  q: z.string().trim().max(60).optional(),
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

const encodeCursor = (row: TransactionRow): string =>
  Buffer.from(JSON.stringify({ t: row.clientCreatedAt.toISOString(), id: row.id })).toString(
    'base64url',
  );

function decodeCursor(cursor: string): { t: Date; id: string } {
  try {
    const parsed = z
      .object({ t: z.iso.datetime(), id: uuid })
      .parse(JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')));
    return { t: new Date(parsed.t), id: parsed.id };
  } catch {
    throw errors.validation([{ path: 'cursor', message: 'Invalid cursor' }]);
  }
}

/** Business date (WIB) of an instant, as `yyyy-mm-dd`. */
export const wibDate = (at: Date): string =>
  new Date(at.getTime() + 7 * 60 * 60 * 1000).toISOString().slice(0, 10);

export function transactionRoutes(ctx: AppContext, guards: Guards) {
  const { db } = ctx;

  /** Employees only see the running shift and today's sales of their outlet (PRD §5). */
  async function assertEmployeeMayView(principal: Principal, row: TransactionRow): Promise<void> {
    if (principal.type !== 'employee') return;
    const today = wibDate(ctx.now());
    if (wibDate(row.clientCreatedAt) === today) return;
    const [shift] = await db
      .select({ status: shifts.status })
      .from(shifts)
      .where(eq(shifts.id, row.shiftId))
      .limit(1);
    if (shift?.status !== 'open') {
      throw errors.forbidden('You can only view transactions of the open shift or of today');
    }
  }

  async function findInOutlet(principal: Principal, id: string): Promise<TransactionRow> {
    const [row] = await db
      .select()
      .from(transactions)
      .where(and(eq(transactions.id, id), eq(transactions.outletId, principal.outletId)))
      .limit(1);
    if (!row) throw errors.notFound('Transaction not found');
    await assertEmployeeMayView(principal, row);
    return row;
  }

  return async (app: FastifyInstance): Promise<void> => {
    app.get('/transactions', { preHandler: guards.ownerOrEmployee }, async (req) => {
      const principal = req.principal;
      if (!principal) throw errors.unauthorized();
      const q = parse(listQuery, req.query);
      const conditions: SQL[] = [eq(transactions.outletId, principal.outletId)];

      if (principal.type === 'employee') {
        if (q.scope === 'today') {
          const today = wibDate(ctx.now());
          conditions.push(
            gte(transactions.clientCreatedAt, startOfBusinessDay(today)),
            lt(transactions.clientCreatedAt, endOfBusinessDay(today)),
          );
        } else {
          const [open] = await db
            .select({ id: shifts.id })
            .from(shifts)
            .where(and(eq(shifts.outletId, principal.outletId), eq(shifts.status, 'open')))
            .limit(1);
          // No running shift: nothing to show for this scope.
          conditions.push(open ? eq(transactions.shiftId, open.id) : sql`false`);
        }
      } else {
        if (q.date_from) {
          conditions.push(gte(transactions.clientCreatedAt, startOfBusinessDay(q.date_from)));
        }
        if (q.date_to) {
          conditions.push(lt(transactions.clientCreatedAt, endOfBusinessDay(q.date_to)));
        }
        if (q.employee_id) conditions.push(eq(transactions.employeeId, q.employee_id));
        if (q.shift_id) conditions.push(eq(transactions.shiftId, q.shift_id));
      }
      if (q.payment_method) conditions.push(eq(transactions.paymentMethod, q.payment_method));
      if (q.status) conditions.push(eq(transactions.status, q.status));
      if (q.q) {
        const like = `%${escapeLike(q.q)}%`;
        const match = or(ilike(transactions.number, like), ilike(transactions.customerLabel, like));
        if (match) conditions.push(match);
      }
      if (q.cursor) {
        const c = decodeCursor(q.cursor);
        const before = or(
          lt(transactions.clientCreatedAt, c.t),
          and(eq(transactions.clientCreatedAt, c.t), lt(transactions.id, c.id)),
        );
        if (before) conditions.push(before);
      }

      const rows = await db
        .select()
        .from(transactions)
        .where(and(...conditions))
        .orderBy(desc(transactions.clientCreatedAt), desc(transactions.id))
        .limit(q.limit + 1);
      const page = rows.slice(0, q.limit);
      const last = page[page.length - 1];
      return {
        data: await toTransactionSummaries(db, page),
        next_cursor: rows.length > q.limit && last ? encodeCursor(last) : null,
      };
    });

    app.post('/transactions', { preHandler: guards.employee }, async (req, reply) => {
      const principal = requireEmployee(req);
      const body = parse(transactionCreateSchema, req.body);
      const device = req.device;
      if (!device) throw errors.unauthorized('Missing device');
      const result = await createTransaction(ctx, body, {
        outletId: principal.outletId,
        device: { id: device.id, code: device.code },
        employeeId: principal.id,
        source: 'api',
        ip: req.ip,
      });
      return reply.status(result.created ? 201 : 200).send(result.transaction);
    });

    app.get(
      '/transactions/:transaction_id',
      { preHandler: guards.ownerOrEmployee },
      async (req) => {
        const principal = req.principal;
        if (!principal) throw errors.unauthorized();
        const { transaction_id: id } = parse(idParams, req.params);
        const row = await findInOutlet(principal, id);
        const [dto] = await toTransactionDetails(db, [row]);
        return dto;
      },
    );

    app.get(
      '/transactions/:transaction_id/receipt',
      { preHandler: guards.ownerOrEmployee },
      async (req) => {
        const principal = req.principal;
        if (!principal) throw errors.unauthorized();
        const { transaction_id: id } = parse(idParams, req.params);
        const row = await findInOutlet(principal, id);
        const transaction = await loadTransactionDto(db, row.id);
        if (!transaction) throw errors.notFound('Transaction not found');
        const { settings } = await loadSettings(db, row.outletId);
        const [cashier] = await db
          .select({ name: employees.name })
          .from(employees)
          .where(eq(employees.id, row.employeeId))
          .limit(1);
        const store = {
          name: settings.displayName,
          address: settings.address,
          phone: settings.phone,
          header: settings.receiptHeader,
          footer: settings.receiptFooter,
        };
        const cashierName = cashier?.name ?? '-';
        return {
          store: { ...store, logo_url: settings.logoUrl },
          cashier_name: cashierName,
          paper_width_mm: 58 as const,
          transaction,
          share_text: formatReceipt(store, cashierName, transaction),
        };
      },
    );
  };
}
