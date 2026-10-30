import type { Config } from './config.js';
import type { Database } from './db/client.js';
import type { TokenService } from './lib/jwt.js';
import type { Notifier } from './modules/notifications/notifier.js';
import type { PaymentService } from './modules/payments/service.js';

/** Shared dependencies handed to every module. `now` is injectable so time-based rules are testable. */
export interface AppContext {
  config: Config;
  db: Database;
  tokens: TokenService;
  now: () => Date;
  /** Fire-and-forget Web Push notifications (ADR-0017); a no-op when VAPID is not configured. */
  notifier: Notifier;
}

export type Principal =
  | {
      type: 'user';
      id: string;
      name: string;
      role: 'owner' | 'manager';
      outletId: string;
    }
  | {
      type: 'employee';
      id: string;
      name: string;
      role: 'cashier';
      outletId: string;
      deviceId: string;
      sessionId: string;
    };

export type UserPrincipal = Extract<Principal, { type: 'user' }>;
export type EmployeePrincipal = Extract<Principal, { type: 'employee' }>;

export interface DeviceContext {
  id: string;
  outletId: string;
  code: string;
  name: string;
}

declare module 'fastify' {
  interface FastifyInstance {
    /** Payment operations, exposed so the server can run the QRIS expiry job. */
    payments: PaymentService;
    /** Exposed so the server can run the notification dispatcher. */
    notifier: Notifier;
  }
  interface FastifyRequest {
    principal?: Principal;
    device?: DeviceContext;
  }
}
