import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import type { AppContext, DeviceContext } from '../../context.js';
import { employeePinAttempts, employeeSessions, employees } from '../../db/schema.js';
import { errors } from '../../errors.js';
import { verifySecret } from '../../lib/passwords.js';
import { writeAudit } from '../audit/audit.js';
import { toEmployee, type EmployeeDto } from '../employees/serialize.js';

export interface EmployeeSession {
  access_token: string;
  expires_in: number;
  employee: EmployeeDto;
}

type Reservation = { locked: true; retryAfterSec: number } | { locked: false; failedCount: number };

export class PinAuthService {
  constructor(private readonly ctx: AppContext) {}

  /**
   * Count the attempt *before* verifying the PIN, atomically (row lock). Parallel guesses therefore
   * cannot slip past the lockout: the 5th attempt locks the employee on this device for 5 minutes.
   */
  private reserveAttempt(employeeId: string, deviceId: string): Promise<Reservation> {
    const { db, config } = this.ctx;
    const now = this.ctx.now();
    return db.transaction(async (tx) => {
      await tx
        .insert(employeePinAttempts)
        .values({ employeeId, deviceId, updatedAt: now })
        .onConflictDoNothing();
      const [row] = await tx
        .select()
        .from(employeePinAttempts)
        .where(
          and(
            eq(employeePinAttempts.employeeId, employeeId),
            eq(employeePinAttempts.deviceId, deviceId),
          ),
        )
        .for('update');
      if (!row) throw new Error('pin attempt row missing');
      if (row.lockedUntil && row.lockedUntil > now) {
        return {
          locked: true,
          retryAfterSec: Math.ceil((row.lockedUntil.getTime() - now.getTime()) / 1000),
        };
      }
      const previous = row.lockedUntil ? 0 : row.failedCount;
      const failedCount = previous + 1;
      const lockedUntil =
        failedCount >= config.pinLockoutMax
          ? new Date(now.getTime() + config.pinLockoutSec * 1000)
          : null;
      await tx
        .update(employeePinAttempts)
        .set({ failedCount, lockedUntil, updatedAt: now })
        .where(
          and(
            eq(employeePinAttempts.employeeId, employeeId),
            eq(employeePinAttempts.deviceId, deviceId),
          ),
        );
      return { locked: false, failedCount };
    });
  }

  async login(
    device: DeviceContext,
    employeeId: string,
    pin: string,
    ip: string,
  ): Promise<EmployeeSession> {
    const { db, config } = this.ctx;
    const now = this.ctx.now();
    const invalid = () => errors.unauthorized('Employee or PIN is incorrect', 'INVALID_PIN');

    const [employee] = await db
      .select()
      .from(employees)
      .where(and(eq(employees.id, employeeId), eq(employees.outletId, device.outletId)))
      .limit(1);
    if (!employee || !employee.isActive) throw invalid();

    const reservation = await this.reserveAttempt(employee.id, device.id);
    const lockedError = (retryAfterSec: number) =>
      errors.locked(
        'PIN_LOCKED',
        'Too many wrong PINs. Employee is locked on this device.',
        retryAfterSec,
      );
    if (reservation.locked) throw lockedError(reservation.retryAfterSec);

    const ok = await verifySecret(employee.pinHash, pin);
    if (!ok) {
      if (reservation.failedCount >= config.pinLockoutMax) {
        await writeAudit(db, {
          outletId: device.outletId,
          actor: { type: 'device', id: device.id },
          action: 'employee.pin_locked',
          entityType: 'employee',
          entityId: employee.id,
          meta: { ip, device_id: device.id, locked_for_sec: config.pinLockoutSec },
        });
        throw lockedError(config.pinLockoutSec);
      }
      throw invalid();
    }

    await db
      .update(employeePinAttempts)
      .set({ failedCount: 0, lockedUntil: null, updatedAt: now })
      .where(
        and(
          eq(employeePinAttempts.employeeId, employee.id),
          eq(employeePinAttempts.deviceId, device.id),
        ),
      );

    const sessionId = randomUUID();
    await db.insert(employeeSessions).values({
      id: sessionId,
      employeeId: employee.id,
      deviceId: device.id,
      createdAt: now,
      expiresAt: new Date(now.getTime() + config.employeeAccessTtlSec * 1000),
    });
    const token = await this.ctx.tokens.signEmployee(
      { sub: employee.id, did: device.id, oid: device.outletId, jti: sessionId },
      config.employeeAccessTtlSec,
    );
    return {
      access_token: token,
      expires_in: config.employeeAccessTtlSec,
      employee: toEmployee(employee),
    };
  }

  async logout(sessionId: string): Promise<void> {
    await this.ctx.db
      .update(employeeSessions)
      .set({ revokedAt: this.ctx.now() })
      .where(eq(employeeSessions.id, sessionId));
  }
}
