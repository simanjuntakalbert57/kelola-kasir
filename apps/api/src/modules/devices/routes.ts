import { and, asc, desc, eq, gt, isNull, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../../context.js';
import {
  devicePairingCodes,
  devices,
  employeeSessions,
  employees,
  outlets,
  transactions,
} from '../../db/schema.js';
import { errors } from '../../errors.js';
import {
  generatePairingCode,
  normalizePairingCode,
  randomToken,
  sha256Hex,
} from '../../lib/crypto.js';
import { isoOrNull } from '../../lib/time.js';
import { parse, UUID_PATTERN } from '../../lib/validate.js';
import { requireUser, type Guards } from '../../plugins/auth.js';
import { writeAudit } from '../audit/audit.js';

const createBody = z.object({ name: z.string().trim().min(1).max(60) });
const pairBody = z.object({
  pairing_code: z.string().min(1).max(32),
  app_version: z.string().max(40).optional(),
  platform: z.enum(['android', 'ios']).optional(),
});
const deviceIdParams = z.object({ device_id: z.string().regex(UUID_PATTERN, 'Invalid UUID') });

type DeviceRow = typeof devices.$inferSelect;

export function toDevice(row: DeviceRow) {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    status: row.revokedAt ? 'revoked' : row.pairedAt ? 'active' : 'pending_pairing',
    paired_at: isoOrNull(row.pairedAt),
    last_seen_at: isoOrNull(row.lastSeenAt),
    app_version: row.appVersion,
  } as const;
}

export function deviceRoutes(ctx: AppContext, guards: Guards) {
  const { db, config } = ctx;

  return async (app: FastifyInstance): Promise<void> => {
    app.get('/devices', { preHandler: guards.owner }, async (req) => {
      const principal = requireUser(req);
      const rows = await db
        .select()
        .from(devices)
        .where(eq(devices.outletId, principal.outletId))
        .orderBy(asc(devices.code));
      return { data: rows.map(toDevice) };
    });

    app.post('/devices', { preHandler: guards.owner }, async (req, reply) => {
      const principal = requireUser(req);
      const body = parse(createBody, req.body);
      const now = ctx.now();
      const result = await db.transaction(async (tx) => {
        const [outlet] = await tx
          .update(outlets)
          .set({ deviceSeq: sql`${outlets.deviceSeq} + 1` })
          .where(eq(outlets.id, principal.outletId))
          .returning({ seq: outlets.deviceSeq });
        if (!outlet) throw errors.notFound('Outlet not found');
        if (outlet.seq > 99) {
          throw errors.conflict(
            'DEVICE_LIMIT_REACHED',
            'Device limit reached',
            'An outlet supports at most 99 devices',
          );
        }
        const [device] = await tx
          .insert(devices)
          .values({
            outletId: principal.outletId,
            code: `K${String(outlet.seq).padStart(2, '0')}`,
            name: body.name,
            createdAt: now,
          })
          .returning();
        if (!device) throw new Error('failed to create device');
        const code = generatePairingCode();
        const expiresAt = new Date(now.getTime() + config.pairingCodeTtlSec * 1000);
        await tx.insert(devicePairingCodes).values({
          deviceId: device.id,
          codeHash: sha256Hex(code),
          expiresAt,
          createdAt: now,
        });
        await writeAudit(tx, {
          outletId: principal.outletId,
          actor: { type: 'user', id: principal.id },
          action: 'device.created',
          entityType: 'device',
          entityId: device.id,
          after: { code: device.code, name: device.name },
          meta: { ip: req.ip },
        });
        return { device, code, expiresAt };
      });
      return reply.status(201).send({
        device: toDevice(result.device),
        pairing_code: result.code,
        pairing_expires_at: result.expiresAt.toISOString(),
      });
    });

    app.post(
      '/devices/pair',
      {
        config: {
          rateLimit: { max: config.rateLimit.pairMax, timeWindow: '1 hour' },
        },
      },
      async (req) => {
        const body = parse(pairBody, req.body);
        const now = ctx.now();
        const codeHash = sha256Hex(normalizePairingCode(body.pairing_code));
        const invalid = () =>
          errors.badRequest(
            'INVALID_PAIRING_CODE',
            'Invalid pairing code',
            'Pairing code is invalid, used or expired',
          );

        const paired = await db.transaction(async (tx) => {
          // Single-use: only one concurrent request can flip used_at from NULL.
          const [claimed] = await tx
            .update(devicePairingCodes)
            .set({ usedAt: now })
            .where(
              and(
                eq(devicePairingCodes.codeHash, codeHash),
                isNull(devicePairingCodes.usedAt),
                gt(devicePairingCodes.expiresAt, now),
              ),
            )
            .returning({ deviceId: devicePairingCodes.deviceId });
          if (!claimed) throw invalid();
          const token = randomToken();
          const [device] = await tx
            .update(devices)
            .set({
              tokenHash: sha256Hex(token),
              pairedAt: now,
              lastSeenAt: now,
              appVersion: body.app_version ?? null,
              platform: body.platform ?? null,
            })
            .where(
              and(
                eq(devices.id, claimed.deviceId),
                isNull(devices.revokedAt),
                isNull(devices.tokenHash),
              ),
            )
            .returning();
          if (!device) throw invalid();
          const [outlet] = await tx
            .select()
            .from(outlets)
            .where(eq(outlets.id, device.outletId))
            .limit(1);
          if (!outlet) throw invalid();
          const [last] = await tx
            .select({ number: transactions.number })
            .from(transactions)
            .where(eq(transactions.deviceId, device.id))
            .orderBy(desc(transactions.clientCreatedAt))
            .limit(1);
          await writeAudit(tx, {
            outletId: device.outletId,
            actor: { type: 'device', id: device.id },
            action: 'device.paired',
            entityType: 'device',
            entityId: device.id,
            meta: {
              ip: req.ip,
              app_version: body.app_version ?? null,
              platform: body.platform ?? null,
            },
          });
          return { device, token, outlet, lastNumber: last?.number ?? null };
        });

        return {
          device: toDevice(paired.device),
          device_token: paired.token,
          outlet: {
            id: paired.outlet.id,
            code: paired.outlet.code,
            name: paired.outlet.name,
            timezone: paired.outlet.timezone,
          },
          last_transaction_number: paired.lastNumber,
        };
      },
    );

    app.get('/devices/me/employees', { preHandler: guards.device }, async (req) => {
      const device = req.device;
      if (!device) throw errors.unauthorized();
      const rows = await db
        .select({ id: employees.id, name: employees.name })
        .from(employees)
        .where(and(eq(employees.outletId, device.outletId), eq(employees.isActive, true)))
        .orderBy(asc(employees.name));
      return { data: rows };
    });

    app.post('/devices/:device_id/revoke', { preHandler: guards.owner }, async (req) => {
      const principal = requireUser(req);
      const { device_id: deviceId } = parse(deviceIdParams, req.params);
      const now = ctx.now();
      return db.transaction(async (tx) => {
        const [existing] = await tx
          .select()
          .from(devices)
          .where(and(eq(devices.id, deviceId), eq(devices.outletId, principal.outletId)))
          .for('update');
        if (!existing) throw errors.notFound('Device not found');
        if (existing.revokedAt) return toDevice(existing);
        const [device] = await tx
          .update(devices)
          .set({ revokedAt: now })
          .where(eq(devices.id, deviceId))
          .returning();
        if (!device) throw errors.notFound('Device not found');
        await tx
          .update(employeeSessions)
          .set({ revokedAt: now })
          .where(and(eq(employeeSessions.deviceId, deviceId), isNull(employeeSessions.revokedAt)));
        await writeAudit(tx, {
          outletId: principal.outletId,
          actor: { type: 'user', id: principal.id },
          action: 'device.revoked',
          entityType: 'device',
          entityId: deviceId,
          before: { status: existing.pairedAt ? 'active' : 'pending_pairing' },
          after: { status: 'revoked' },
          meta: { ip: req.ip },
        });
        return toDevice(device);
      });
    });
  };
}
