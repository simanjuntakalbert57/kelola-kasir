import { and, desc, eq, gte, lt, or, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext, EmployeePrincipal } from '../../context.js';
import { isUniqueViolation } from '../../db/client.js';
import { shifts, transactions } from '../../db/schema.js';
import { errors } from '../../errors.js';
import { endOfBusinessDay, startOfBusinessDay } from '../../lib/time.js';
import { parse, UUID_PATTERN } from '../../lib/validate.js';
import { requireEmployee, requireUser, type Guards } from '../../plugins/auth.js';
import { writeAudit } from '../audit/audit.js';
import { buildShiftSummary, computeShiftTotals, toShiftDtos, type ShiftRow } from './summary.js';

const ONE_OPEN_INDEX = 'shifts_one_open_per_outlet';
const MAX_CLOCK_SKEW_MS = 10 * 60 * 1000;

const rupiah = z.number().int().min(0).max(1_000_000_000_000);
const uuid = z.string().regex(UUID_PATTERN, 'Invalid UUID');
const MIN_TIMESTAMP_MS = Date.UTC(2020, 0, 1);
const MAX_TIMESTAMP_MS = Date.UTC(2100, 0, 1);
const isoDate = z.iso
  .datetime({ offset: true })
  .transform((v) => new Date(v))
  .refine(
    (d) => d.getTime() >= MIN_TIMESTAMP_MS && d.getTime() < MAX_TIMESTAMP_MS,
    'Timestamp is out of the supported range (2020-2099)',
  );
const idParams = z.object({ shift_id: uuid });
const openBody = z.object({ id: uuid, opening_cash: rupiah, opened_at: isoDate });
const closeBody = z.object({
  actual_cash: rupiah,
  closed_at: isoDate,
  closing_note: z.string().max(500).optional(),
  closed_offline: z.boolean().default(false),
  unsynced_count: z.number().int().min(0).optional(),
});
const listQuery = z.object({
  date_from: z.iso.date().optional(),
  date_to: z.iso.date().optional(),
  employee_id: uuid.optional(),
  status: z.enum(['open', 'closed']).optional(),
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

function encodeCursor(row: ShiftRow): string {
  return Buffer.from(JSON.stringify({ t: row.openedAt.toISOString(), id: row.id })).toString(
    'base64url',
  );
}

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

export function shiftRoutes(ctx: AppContext, guards: Guards) {
  const { db } = ctx;

  async function getOpenShift(outletId: string): Promise<ShiftRow | undefined> {
    const [row] = await db
      .select()
      .from(shifts)
      .where(and(eq(shifts.outletId, outletId), eq(shifts.status, 'open')))
      .limit(1);
    return row;
  }

  async function closeShift(
    principal: EmployeePrincipal,
    shiftId: string,
    body: z.output<typeof closeBody>,
    ip: string,
  ) {
    const now = ctx.now();
    if (body.closed_at.getTime() > now.getTime() + MAX_CLOCK_SKEW_MS) {
      throw errors.validation([{ path: 'closed_at', message: 'closed_at is in the future' }]);
    }
    const closed = await db.transaction(async (tx) => {
      const [shift] = await tx
        .select()
        .from(shifts)
        .where(and(eq(shifts.id, shiftId), eq(shifts.outletId, principal.outletId)))
        .for('update');
      if (!shift) throw errors.notFound('Shift not found');

      if (shift.status === 'closed') {
        const replay =
          shift.closedBy === principal.id &&
          shift.actualCash === body.actual_cash &&
          shift.closedAt?.getTime() === body.closed_at.getTime();
        if (replay) return shift;
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
          closedBy: principal.id,
          closedDeviceId: principal.deviceId,
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
        outletId: principal.outletId,
        actor: { type: 'employee', id: principal.id },
        action: body.closed_offline ? 'shift.closed_offline' : 'shift.closed',
        entityType: 'shift',
        entityId: shiftId,
        after: {
          expected_cash: totals.expectedCash,
          actual_cash: body.actual_cash,
          cash_difference: difference,
          unsynced_count: body.unsynced_count ?? null,
        },
        meta: { ip, device_id: principal.deviceId, closed_offline: body.closed_offline },
      });
      return updated;
    });
    return buildShiftSummary(db, closed);
  }

  return async (app: FastifyInstance): Promise<void> => {
    app.get('/shifts', { preHandler: guards.owner }, async (req) => {
      const principal = requireUser(req);
      const q = parse(listQuery, req.query);
      const conditions = [eq(shifts.outletId, principal.outletId)];
      if (q.status) conditions.push(eq(shifts.status, q.status));
      if (q.date_from) conditions.push(gte(shifts.openedAt, startOfBusinessDay(q.date_from)));
      if (q.date_to) conditions.push(lt(shifts.openedAt, endOfBusinessDay(q.date_to)));
      if (q.employee_id) {
        conditions.push(
          or(eq(shifts.openedBy, q.employee_id), eq(shifts.closedBy, q.employee_id)) ?? sql`true`,
        );
      }
      if (q.cursor) {
        const c = decodeCursor(q.cursor);
        conditions.push(
          or(lt(shifts.openedAt, c.t), and(eq(shifts.openedAt, c.t), lt(shifts.id, c.id))) ??
            sql`true`,
        );
      }
      const rows = await db
        .select()
        .from(shifts)
        .where(and(...conditions))
        .orderBy(desc(shifts.openedAt), desc(shifts.id))
        .limit(q.limit + 1);
      const page = rows.slice(0, q.limit);
      const last = page[page.length - 1];
      return {
        data: await toShiftDtos(db, page),
        next_cursor: rows.length > q.limit && last ? encodeCursor(last) : null,
      };
    });

    app.post('/shifts', { preHandler: guards.employee }, async (req, reply) => {
      const principal = requireEmployee(req);
      const body = parse(openBody, req.body);
      if (body.opened_at.getTime() > ctx.now().getTime() + MAX_CLOCK_SKEW_MS) {
        throw errors.validation([{ path: 'opened_at', message: 'opened_at is in the future' }]);
      }

      const replay = async () => {
        const [existing] = await db.select().from(shifts).where(eq(shifts.id, body.id)).limit(1);
        if (!existing) return undefined;
        if (existing.outletId !== principal.outletId) {
          throw errors.conflict('ID_CONFLICT', 'Identifier already in use');
        }
        const [dto] = await toShiftDtos(db, [existing]);
        return dto;
      };
      const already = await replay();
      if (already) return reply.status(200).send(already);

      try {
        const created = await db.transaction(async (tx) => {
          const [row] = await tx
            .insert(shifts)
            .values({
              id: body.id,
              outletId: principal.outletId,
              openedDeviceId: principal.deviceId,
              openedBy: principal.id,
              status: 'open',
              openingCash: body.opening_cash,
              openedAt: body.opened_at,
            })
            .returning();
          if (!row) throw new Error('failed to open shift');
          await writeAudit(tx, {
            outletId: principal.outletId,
            actor: { type: 'employee', id: principal.id },
            action: 'shift.opened',
            entityType: 'shift',
            entityId: row.id,
            after: { opening_cash: row.openingCash },
            meta: { ip: req.ip, device_id: principal.deviceId },
          });
          return row;
        });
        const [dto] = await toShiftDtos(db, [created]);
        return reply.status(201).send(dto);
      } catch (err) {
        if (isUniqueViolation(err, ONE_OPEN_INDEX)) {
          const open = await getOpenShift(principal.outletId);
          throw errors.conflict(
            'SHIFT_ALREADY_OPEN',
            'A shift is already open',
            open
              ? `Shift ${open.id} is already open for this outlet; join it instead`
              : 'A shift is already open for this outlet',
          );
        }
        if (isUniqueViolation(err)) {
          // Concurrent retry with the same id: behave as an idempotent replay.
          const again = await replay();
          if (again) return reply.status(200).send(again);
        }
        throw err;
      }
    });

    app.get('/shifts/current', { preHandler: guards.employee }, async (req, reply) => {
      const principal = requireEmployee(req);
      const open = await getOpenShift(principal.outletId);
      if (!open) return reply.status(204).send();
      const [dto] = await toShiftDtos(db, [open]);
      return dto;
    });

    app.get('/shifts/:shift_id/summary', { preHandler: guards.ownerOrEmployee }, async (req) => {
      const principal = req.principal;
      if (!principal) throw errors.unauthorized();
      const { shift_id: shiftId } = parse(idParams, req.params);
      const [shift] = await db
        .select()
        .from(shifts)
        .where(and(eq(shifts.id, shiftId), eq(shifts.outletId, principal.outletId)))
        .limit(1);
      if (!shift) throw errors.notFound('Shift not found');
      if (principal.type === 'employee') {
        // Employees see the open shift of their outlet, or a shift they closed themselves.
        const allowed = shift.status === 'open' || shift.closedBy === principal.id;
        if (!allowed)
          throw errors.forbidden('You can only view the open shift or a shift you closed');
      }
      return buildShiftSummary(db, shift);
    });

    app.post('/shifts/:shift_id/close', { preHandler: guards.employee }, async (req) => {
      const principal = requireEmployee(req);
      const { shift_id: shiftId } = parse(idParams, req.params);
      const body = parse(closeBody, req.body);
      return closeShift(principal, shiftId, body, req.ip);
    });
  };
}
