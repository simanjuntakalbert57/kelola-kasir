import { and, eq, gt, isNull } from 'drizzle-orm';
import type { FastifyReply, FastifyRequest, preHandlerAsyncHookHandler } from 'fastify';
import type { AppContext, EmployeePrincipal, UserPrincipal } from '../context.js';
import { devices, employeeSessions, employees, outletMembers, users } from '../db/schema.js';
import { errors } from '../errors.js';
import { sha256Hex } from '../lib/crypto.js';
import type { TokenClaims } from '../lib/jwt.js';

export interface Guards {
  /** Owner (or manager) bearer token. Employee tokens are rejected with 403. */
  owner: preHandlerAsyncHookHandler;
  /** Paired, non-revoked device (`X-Device-Token`). */
  device: preHandlerAsyncHookHandler;
  /** Employee bearer token together with the device it was issued for. */
  employee: preHandlerAsyncHookHandler;
  /** Either an owner token, or an employee token with its device. */
  ownerOrEmployee: preHandlerAsyncHookHandler;
}

function bearerToken(req: FastifyRequest): string | null {
  const header = req.headers.authorization;
  if (!header) return null;
  const [scheme, token] = header.split(' ');
  return scheme?.toLowerCase() === 'bearer' && token ? token : null;
}

export function createGuards(ctx: AppContext): Guards {
  const { db } = ctx;

  async function loadDevice(req: FastifyRequest): Promise<void> {
    const raw = req.headers['x-device-token'];
    const token = Array.isArray(raw) ? raw[0] : raw;
    if (!token) throw errors.unauthorized('Missing X-Device-Token header');
    const [device] = await db
      .select()
      .from(devices)
      .where(eq(devices.tokenHash, sha256Hex(token)))
      .limit(1);
    if (!device) throw errors.unauthorized('Unknown device token');
    if (device.revokedAt)
      throw errors.unauthorized('This device has been revoked', 'DEVICE_REVOKED');
    const now = ctx.now();
    if (!device.lastSeenAt || now.getTime() - device.lastSeenAt.getTime() > 60_000) {
      await db.update(devices).set({ lastSeenAt: now }).where(eq(devices.id, device.id));
    }
    req.device = { id: device.id, outletId: device.outletId, code: device.code, name: device.name };
  }

  async function loadOwner(
    claims: Extract<TokenClaims, { kind: 'owner' }>,
  ): Promise<UserPrincipal> {
    const [row] = await db
      .select({ id: users.id, name: users.name })
      .from(users)
      .innerJoin(outletMembers, eq(outletMembers.userId, users.id))
      .where(
        and(
          eq(users.id, claims.sub),
          eq(users.isActive, true),
          eq(outletMembers.outletId, claims.oid),
          eq(outletMembers.role, claims.role),
        ),
      )
      .limit(1);
    if (!row) throw errors.unauthorized('Account is no longer active');
    return { type: 'user', id: row.id, name: row.name, role: claims.role, outletId: claims.oid };
  }

  async function loadEmployee(
    req: FastifyRequest,
    claims: Extract<TokenClaims, { kind: 'employee' }>,
  ): Promise<EmployeePrincipal> {
    await loadDevice(req);
    const device = req.device;
    if (!device || device.id !== claims.did || device.outletId !== claims.oid) {
      throw errors.unauthorized('Token was not issued for this device');
    }
    const [row] = await db
      .select({ id: employees.id, name: employees.name })
      .from(employeeSessions)
      .innerJoin(employees, eq(employees.id, employeeSessions.employeeId))
      .where(
        and(
          eq(employeeSessions.id, claims.jti),
          eq(employeeSessions.deviceId, device.id),
          isNull(employeeSessions.revokedAt),
          gt(employeeSessions.expiresAt, ctx.now()),
          eq(employees.id, claims.sub),
          eq(employees.outletId, claims.oid),
          eq(employees.isActive, true),
        ),
      )
      .limit(1);
    if (!row) throw errors.unauthorized('Session ended, please log in again');
    return {
      type: 'employee',
      id: row.id,
      name: row.name,
      role: 'cashier',
      outletId: claims.oid,
      deviceId: device.id,
      sessionId: claims.jti,
    };
  }

  async function verifyBearer(req: FastifyRequest): Promise<TokenClaims> {
    const token = bearerToken(req);
    if (!token) throw errors.unauthorized('Missing bearer token');
    const claims = await ctx.tokens.verify(token);
    if (!claims) throw errors.unauthorized('Invalid or expired token');
    return claims;
  }

  const wrap =
    (fn: (req: FastifyRequest, reply: FastifyReply) => Promise<void>): preHandlerAsyncHookHandler =>
    async (req, reply) => {
      await fn(req, reply);
    };

  return {
    device: wrap(async (req) => {
      await loadDevice(req);
    }),
    owner: wrap(async (req) => {
      const claims = await verifyBearer(req);
      if (claims.kind !== 'owner') throw errors.forbidden('Owner access is required');
      req.principal = await loadOwner(claims);
    }),
    employee: wrap(async (req) => {
      const claims = await verifyBearer(req);
      if (claims.kind !== 'employee') throw errors.forbidden('Employee access is required');
      req.principal = await loadEmployee(req, claims);
    }),
    ownerOrEmployee: wrap(async (req) => {
      const claims = await verifyBearer(req);
      req.principal =
        claims.kind === 'owner' ? await loadOwner(claims) : await loadEmployee(req, claims);
    }),
  };
}

export function requireUser(req: FastifyRequest): UserPrincipal {
  if (req.principal?.type !== 'user') throw errors.forbidden('Owner access is required');
  return req.principal;
}

export function requireEmployee(req: FastifyRequest): EmployeePrincipal {
  if (req.principal?.type !== 'employee') throw errors.forbidden('Employee access is required');
  return req.principal;
}
