import { randomUUID } from 'node:crypto';
import { and, desc, eq, gte, lt, or, sql, type SQL } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../../context.js';
import { auditLogs, outletMembers, transactions, users, voidRequests } from '../../db/schema.js';
import { errors } from '../../errors.js';
import { verifySecret } from '../../lib/passwords.js';
import { parse } from '../../lib/validate.js';
import { requireEmployee, requireUser, type Guards } from '../../plugins/auth.js';
import { writeAudit } from '../audit/audit.js';
import { findVisibleTransaction } from '../transactions/access.js';
import { loadTransactionDto, toVoidRequest } from '../transactions/serialize.js';
import {
  decideVoid,
  requestVoid,
  voidCreateSchema,
  voidDecisionSchema,
  voidDirectly,
} from './service.js';

const transactionParams = z.object({ transaction_id: z.uuid() });
const voidParams = z.object({ void_request_id: z.uuid() });
const listQuery = z.object({
  status: z.enum(['pending', 'approved', 'rejected']).optional(),
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
const pinBody = voidDecisionSchema.extend({ owner_pin: z.string().regex(/^[0-9]{6}$/) });

/** Wrong owner PINs tolerated per outlet within the window before the PIN pad is locked. */
export const OWNER_PIN_MAX_FAILURES = 5;
const OWNER_PIN_WINDOW_MS = 15 * 60 * 1000;
const FAILED_PIN_ACTION = 'void.owner_pin_failed';

function decodeCursor(cursor: string): { t: Date; id: string } {
  try {
    const parsed = z
      .object({ t: z.iso.datetime(), id: z.uuid() })
      .parse(JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')));
    return { t: new Date(parsed.t), id: parsed.id };
  } catch {
    throw errors.validation([{ path: 'cursor', message: 'Invalid cursor' }]);
  }
}

export function voidRoutes(ctx: AppContext, guards: Guards) {
  const { db } = ctx;

  /** The owner whose PIN matches, among the outlet's owners/managers that have one set. */
  async function findOwnerByPin(outletId: string, pin: string): Promise<string | undefined> {
    const candidates = await db
      .select({ id: users.id, hash: users.ownerPinHash })
      .from(users)
      .innerJoin(outletMembers, eq(outletMembers.userId, users.id))
      .where(and(eq(outletMembers.outletId, outletId), eq(users.isActive, true)));
    for (const c of candidates) {
      if (c.hash && (await verifySecret(c.hash, pin))) return c.id;
    }
    return undefined;
  }

  return async (app: FastifyInstance): Promise<void> => {
    app.post(
      '/transactions/:transaction_id/void-requests',
      { preHandler: guards.ownerOrEmployee },
      async (req, reply) => {
        const principal = req.principal;
        if (!principal) throw errors.unauthorized();
        const { transaction_id: transactionId } = parse(transactionParams, req.params);
        const body = parse(voidCreateSchema, req.body);

        if (principal.type === 'user') {
          const row = await findVisibleTransaction(db, ctx.now(), principal, transactionId);
          await voidDirectly(
            ctx,
            { outletId: principal.outletId, userId: principal.id, ip: req.ip },
            row.id,
            body.reason,
          );
          const dto = await loadTransactionDto(db, row.id);
          return reply.status(200).send(dto);
        }

        const employee = requireEmployee(req);
        await findVisibleTransaction(db, ctx.now(), employee, transactionId);
        const result = await requestVoid(
          ctx,
          {
            outletId: employee.outletId,
            employeeId: employee.id,
            deviceId: employee.deviceId,
            source: 'api',
            ip: req.ip,
          },
          transactionId,
          { id: body.id ?? randomUUID(), reason: body.reason, requestedAt: ctx.now() },
        );
        return reply.status(result.created ? 201 : 200).send(result.voidRequest);
      },
    );

    app.get('/void-requests', { preHandler: guards.owner }, async (req) => {
      const principal = requireUser(req);
      const q = parse(listQuery, req.query);
      const conditions: SQL[] = [eq(transactions.outletId, principal.outletId)];
      if (q.status) conditions.push(eq(voidRequests.status, q.status));
      if (q.cursor) {
        const c = decodeCursor(q.cursor);
        const before = or(
          lt(voidRequests.requestedAt, c.t),
          and(eq(voidRequests.requestedAt, c.t), lt(voidRequests.id, c.id)),
        );
        if (before) conditions.push(before);
      }
      const rows = await db
        .select({ request: voidRequests, transaction: transactions })
        .from(voidRequests)
        .innerJoin(transactions, eq(transactions.id, voidRequests.transactionId))
        .where(and(...conditions))
        .orderBy(desc(voidRequests.requestedAt), desc(voidRequests.id))
        .limit(q.limit + 1);
      const page = rows.slice(0, q.limit);
      const last = page[page.length - 1];
      return {
        data: await Promise.all(page.map((r) => toVoidRequest(db, r.request, r.transaction))),
        next_cursor:
          rows.length > q.limit && last
            ? Buffer.from(
                JSON.stringify({ t: last.request.requestedAt.toISOString(), id: last.request.id }),
              ).toString('base64url')
            : null,
      };
    });

    for (const decision of ['approve', 'reject'] as const) {
      app.post(
        `/void-requests/:void_request_id/${decision}`,
        { preHandler: guards.owner },
        async (req) => {
          const principal = requireUser(req);
          const { void_request_id: id } = parse(voidParams, req.params);
          const body = parse(voidDecisionSchema, req.body);
          return decideVoid(
            ctx,
            {
              outletId: principal.outletId,
              userId: principal.id,
              channel: 'dashboard',
              ip: req.ip,
            },
            id,
            decision,
            body.note,
          );
        },
      );
    }

    app.post(
      '/void-requests/:void_request_id/approve-with-pin',
      { preHandler: guards.employee },
      async (req) => {
        const employee = requireEmployee(req);
        const { void_request_id: id } = parse(voidParams, req.params);
        const body = parse(pinBody, req.body);

        // A 6-digit PIN is guessable, so failures are counted per outlet (not per request origin).
        const since = new Date(ctx.now().getTime() - OWNER_PIN_WINDOW_MS);
        const [failed] = await db
          .select({ n: sql<number>`count(*)::int` })
          .from(auditLogs)
          .where(
            and(
              eq(auditLogs.outletId, employee.outletId),
              eq(auditLogs.action, FAILED_PIN_ACTION),
              gte(auditLogs.createdAt, since),
            ),
          );
        if ((failed?.n ?? 0) >= OWNER_PIN_MAX_FAILURES) {
          throw errors.locked(
            'OWNER_PIN_LOCKED',
            'Too many wrong owner PINs; try again in 15 minutes',
            OWNER_PIN_WINDOW_MS / 1000,
          );
        }
        const ownerId = await findOwnerByPin(employee.outletId, body.owner_pin);
        if (!ownerId) {
          await writeAudit(db, {
            outletId: employee.outletId,
            actor: { type: 'employee', id: employee.id },
            action: FAILED_PIN_ACTION,
            entityType: 'void_request',
            entityId: id,
            meta: { device_id: employee.deviceId, ip: req.ip },
          });
          throw errors.unauthorized('Owner PIN is incorrect', 'INVALID_OWNER_PIN');
        }
        return decideVoid(
          ctx,
          {
            outletId: employee.outletId,
            userId: ownerId,
            channel: 'device_pin',
            viaEmployeeId: employee.id,
            deviceId: employee.deviceId,
            ip: req.ip,
          },
          id,
          'approve',
          body.note,
        );
      },
    );
  };
}
