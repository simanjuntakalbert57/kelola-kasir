import { randomUUID } from 'node:crypto';
import { and, asc, eq } from 'drizzle-orm';
import type { AppContext } from '../../context.js';
import { outletMembers, outlets, refreshTokens, users } from '../../db/schema.js';
import { errors } from '../../errors.js';
import { randomToken, sha256Hex } from '../../lib/crypto.js';
import { hashSecret, verifyDummy, verifySecret } from '../../lib/passwords.js';
import { writeAudit } from '../audit/audit.js';

export interface OutletRef {
  id: string;
  code: string;
  name: string;
  timezone: string;
}

export interface OwnerSession {
  access_token: string;
  expires_in: number;
  user: { id: string; email: string; name: string; outlets: OutletRef[] };
}

export interface OwnerLoginResult {
  session: OwnerSession;
  refreshToken: string;
}

export class OwnerAuthService {
  constructor(private readonly ctx: Omit<AppContext, 'notifier'>) {}

  private async memberships(userId: string) {
    return (
      this.ctx.db
        .select({
          outlet: {
            id: outlets.id,
            code: outlets.code,
            name: outlets.name,
            timezone: outlets.timezone,
          },
          role: outletMembers.role,
        })
        .from(outletMembers)
        .innerJoin(outlets, eq(outlets.id, outletMembers.outletId))
        .where(eq(outletMembers.userId, userId))
        // 'manager' < 'owner' alphabetically, so sort the owner role first via the code afterwards.
        .orderBy(asc(outlets.code))
    );
  }

  private async buildSession(user: { id: string; email: string; name: string }, familyId: string) {
    const memberships = await this.memberships(user.id);
    const primary = memberships.find((m) => m.role === 'owner') ?? memberships[0];
    if (!primary) throw errors.forbidden('This account is not a member of any outlet');
    const access = await this.ctx.tokens.signOwner(
      { sub: user.id, oid: primary.outlet.id, role: primary.role as 'owner' | 'manager' },
      this.ctx.config.ownerAccessTtlSec,
    );
    const refreshToken = randomToken();
    const now = this.ctx.now();
    await this.ctx.db.insert(refreshTokens).values({
      userId: user.id,
      familyId,
      tokenHash: sha256Hex(refreshToken),
      createdAt: now,
      expiresAt: new Date(now.getTime() + this.ctx.config.refreshTtlSec * 1000),
    });
    const session: OwnerSession = {
      access_token: access,
      expires_in: this.ctx.config.ownerAccessTtlSec,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        outlets: memberships.map((m) => m.outlet),
      },
    };
    return { session, refreshToken };
  }

  async login(email: string, password: string, ip: string): Promise<OwnerLoginResult> {
    const { db, config } = this.ctx;
    const now = this.ctx.now();
    const [found] = await db
      .select()
      .from(users)
      .where(eq(users.email, email.trim().toLowerCase()))
      .limit(1);
    if (!found || !found.isActive) {
      await verifyDummy(password);
      throw errors.unauthorized('Email or password is incorrect', 'INVALID_CREDENTIALS');
    }
    if (found.lockedUntil && found.lockedUntil > now) {
      throw errors.tooManyRequests(
        'ACCOUNT_LOCKED',
        'Too many failed attempts. Try again later.',
        Math.ceil((found.lockedUntil.getTime() - now.getTime()) / 1000),
      );
    }

    const ok = await verifySecret(found.passwordHash, password);
    if (!ok) {
      const lockedUntil = await db.transaction(async (tx) => {
        const [row] = await tx.select().from(users).where(eq(users.id, found.id)).for('update');
        if (!row) return null;
        const expired = row.lockedUntil !== null && row.lockedUntil <= now;
        const failed = (expired ? 0 : row.failedLoginCount) + 1;
        const lockUntil =
          failed >= config.ownerLockoutMax
            ? new Date(now.getTime() + config.ownerLockoutSec * 1000)
            : null;
        await tx
          .update(users)
          .set({ failedLoginCount: failed, lockedUntil: lockUntil })
          .where(eq(users.id, found.id));
        if (lockUntil) {
          const memberships = await tx
            .select({ outletId: outletMembers.outletId })
            .from(outletMembers)
            .where(eq(outletMembers.userId, found.id));
          for (const m of memberships) {
            await writeAudit(tx, {
              outletId: m.outletId,
              actor: { type: 'user', id: found.id },
              action: 'auth.owner_locked',
              entityType: 'user',
              entityId: found.id,
              meta: { ip, locked_until: lockUntil.toISOString() },
            });
          }
        }
        return lockUntil;
      });
      if (lockedUntil) {
        throw errors.tooManyRequests(
          'ACCOUNT_LOCKED',
          'Too many failed attempts. Try again later.',
          config.ownerLockoutSec,
        );
      }
      throw errors.unauthorized('Email or password is incorrect', 'INVALID_CREDENTIALS');
    }

    if (found.failedLoginCount > 0 || found.lockedUntil) {
      await db
        .update(users)
        .set({ failedLoginCount: 0, lockedUntil: null })
        .where(eq(users.id, found.id));
    }
    return this.buildSession(found, randomUUID());
  }

  /** Rotate a refresh token. Reusing an already-rotated token revokes the whole family. */
  async refresh(rawToken: string | undefined): Promise<OwnerLoginResult> {
    if (!rawToken) throw errors.unauthorized('Missing refresh token');
    const { db } = this.ctx;
    const now = this.ctx.now();
    const hash = sha256Hex(rawToken);

    const outcome = await db.transaction(async (tx) => {
      const [row] = await tx
        .select()
        .from(refreshTokens)
        .where(eq(refreshTokens.tokenHash, hash))
        .for('update');
      if (!row) return { kind: 'invalid' as const };
      if (row.usedAt || row.revokedAt) {
        await tx
          .update(refreshTokens)
          .set({ revokedAt: now })
          .where(and(eq(refreshTokens.familyId, row.familyId)));
        return { kind: 'reuse' as const };
      }
      if (row.expiresAt <= now) return { kind: 'invalid' as const };
      await tx.update(refreshTokens).set({ usedAt: now }).where(eq(refreshTokens.id, row.id));
      return { kind: 'ok' as const, row };
    });
    if (outcome.kind !== 'ok') throw errors.unauthorized('Refresh token is invalid or expired');

    const [user] = await db.select().from(users).where(eq(users.id, outcome.row.userId)).limit(1);
    if (!user || !user.isActive) throw errors.unauthorized('Account is no longer active');
    return this.buildSession(user, outcome.row.familyId);
  }

  /** Revoke the whole refresh family behind the cookie, if it belongs to this user. */
  async logout(userId: string, rawToken: string | undefined): Promise<void> {
    if (!rawToken) return;
    const { db } = this.ctx;
    const [row] = await db
      .select()
      .from(refreshTokens)
      .where(eq(refreshTokens.tokenHash, sha256Hex(rawToken)))
      .limit(1);
    if (!row || row.userId !== userId) return;
    await db
      .update(refreshTokens)
      .set({ revokedAt: this.ctx.now() })
      .where(eq(refreshTokens.familyId, row.familyId));
  }

  async createOwner(input: {
    email: string;
    password: string;
    name: string;
    outletId: string;
    role?: 'owner' | 'manager';
  }): Promise<string> {
    const passwordHash = await hashSecret(input.password);
    return this.ctx.db.transaction(async (tx) => {
      const [user] = await tx
        .insert(users)
        .values({ email: input.email.trim().toLowerCase(), passwordHash, name: input.name })
        .returning({ id: users.id });
      if (!user) throw new Error('failed to create user');
      await tx
        .insert(outletMembers)
        .values({ outletId: input.outletId, userId: user.id, role: input.role ?? 'owner' });
      return user.id;
    });
  }
}
