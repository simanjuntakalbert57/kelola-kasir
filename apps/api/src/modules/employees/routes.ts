import { and, asc, eq, isNull } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../../context.js';
import { isUniqueViolation, type DbOrTx } from '../../db/client.js';
import { employeePinAttempts, employeeSessions, employees } from '../../db/schema.js';
import { errors } from '../../errors.js';
import { pinFingerprint } from '../../lib/crypto.js';
import { hashSecret } from '../../lib/passwords.js';
import { parse, uuid } from '../../lib/validate.js';
import { requireUser, type Guards } from '../../plugins/auth.js';
import { writeAudit } from '../audit/audit.js';
import { toEmployee } from './serialize.js';

const PIN_UNIQUE = 'employees_pin_unique_per_outlet';
const pin = z.string().regex(/^[0-9]{6}$/, 'PIN must be 6 digits');
const idParams = z.object({ employee_id: uuid });
const listQuery = z.object({ is_active: z.enum(['true', 'false']).optional() });
const createBody = z.object({ name: z.string().trim().min(1).max(60), pin });
const updateBody = z
  .object({ name: z.string().trim().min(1).max(60), is_active: z.boolean() })
  .partial()
  .refine((v) => v.name !== undefined || v.is_active !== undefined, {
    message: 'Provide name and/or is_active',
  });
const resetBody = z.object({ pin });

const pinConflict = () =>
  errors.conflict(
    'PIN_NOT_UNIQUE',
    'PIN already in use',
    'Another employee in this outlet already uses this PIN',
  );

export function employeeRoutes(ctx: AppContext, guards: Guards) {
  const { db, config } = ctx;

  async function endSessions(tx: DbOrTx, employeeId: string): Promise<void> {
    await tx
      .update(employeeSessions)
      .set({ revokedAt: ctx.now() })
      .where(and(eq(employeeSessions.employeeId, employeeId), isNull(employeeSessions.revokedAt)));
  }

  return async (app: FastifyInstance): Promise<void> => {
    app.get('/employees', { preHandler: guards.owner }, async (req) => {
      const principal = requireUser(req);
      const query = parse(listQuery, req.query);
      const conditions = [eq(employees.outletId, principal.outletId)];
      if (query.is_active !== undefined)
        conditions.push(eq(employees.isActive, query.is_active === 'true'));
      const rows = await db
        .select()
        .from(employees)
        .where(and(...conditions))
        .orderBy(asc(employees.name), asc(employees.createdAt));
      return { data: rows.map(toEmployee) };
    });

    app.post('/employees', { preHandler: guards.owner }, async (req, reply) => {
      const principal = requireUser(req);
      const body = parse(createBody, req.body);
      const pinHash = await hashSecret(body.pin);
      try {
        const created = await db.transaction(async (tx) => {
          const [row] = await tx
            .insert(employees)
            .values({
              outletId: principal.outletId,
              name: body.name,
              pinHash,
              pinFingerprint: pinFingerprint(
                config.pinFingerprintSecret,
                principal.outletId,
                body.pin,
              ),
              createdAt: ctx.now(),
            })
            .returning();
          if (!row) throw new Error('failed to create employee');
          await writeAudit(tx, {
            outletId: principal.outletId,
            actor: { type: 'user', id: principal.id },
            action: 'employee.created',
            entityType: 'employee',
            entityId: row.id,
            after: { name: row.name },
            meta: { ip: req.ip },
          });
          return row;
        });
        return reply.status(201).send(toEmployee(created));
      } catch (err) {
        if (isUniqueViolation(err, PIN_UNIQUE)) throw pinConflict();
        throw err;
      }
    });

    app.patch('/employees/:employee_id', { preHandler: guards.owner }, async (req) => {
      const principal = requireUser(req);
      const { employee_id: id } = parse(idParams, req.params);
      const body = parse(updateBody, req.body);
      try {
        return await db.transaction(async (tx) => {
          const [before] = await tx
            .select()
            .from(employees)
            .where(and(eq(employees.id, id), eq(employees.outletId, principal.outletId)))
            .for('update');
          if (!before) throw errors.notFound('Employee not found');
          const [after] = await tx
            .update(employees)
            .set({
              ...(body.name !== undefined ? { name: body.name } : {}),
              ...(body.is_active !== undefined ? { isActive: body.is_active } : {}),
            })
            .where(eq(employees.id, id))
            .returning();
          if (!after) throw errors.notFound('Employee not found');
          if (before.isActive && !after.isActive) await endSessions(tx, id);
          await writeAudit(tx, {
            outletId: principal.outletId,
            actor: { type: 'user', id: principal.id },
            action:
              after.isActive === before.isActive
                ? 'employee.updated'
                : after.isActive
                  ? 'employee.activated'
                  : 'employee.deactivated',
            entityType: 'employee',
            entityId: id,
            before: { name: before.name, is_active: before.isActive },
            after: { name: after.name, is_active: after.isActive },
            meta: { ip: req.ip },
          });
          return toEmployee(after);
        });
      } catch (err) {
        // Re-activating an employee whose PIN is now used by someone else.
        if (isUniqueViolation(err, PIN_UNIQUE)) throw pinConflict();
        throw err;
      }
    });

    app.post(
      '/employees/:employee_id/reset-pin',
      { preHandler: guards.owner },
      async (req, reply) => {
        const principal = requireUser(req);
        const { employee_id: id } = parse(idParams, req.params);
        const body = parse(resetBody, req.body);
        const pinHash = await hashSecret(body.pin);
        try {
          await db.transaction(async (tx) => {
            const [row] = await tx
              .update(employees)
              .set({
                pinHash,
                pinFingerprint: pinFingerprint(
                  config.pinFingerprintSecret,
                  principal.outletId,
                  body.pin,
                ),
              })
              .where(and(eq(employees.id, id), eq(employees.outletId, principal.outletId)))
              .returning({ id: employees.id });
            if (!row) throw errors.notFound('Employee not found');
            await endSessions(tx, id);
            await tx.delete(employeePinAttempts).where(eq(employeePinAttempts.employeeId, id));
            await writeAudit(tx, {
              outletId: principal.outletId,
              actor: { type: 'user', id: principal.id },
              action: 'employee.pin_reset',
              entityType: 'employee',
              entityId: id,
              meta: { ip: req.ip },
            });
          });
        } catch (err) {
          if (isUniqueViolation(err, PIN_UNIQUE)) throw pinConflict();
          throw err;
        }
        return reply.status(204).send();
      },
    );
  };
}
