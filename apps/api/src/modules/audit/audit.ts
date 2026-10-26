import type { DbOrTx } from '../../db/client.js';
import { auditLogs } from '../../db/schema.js';

export interface AuditEntry {
  outletId: string | null;
  actor: { type: 'user' | 'employee' | 'device' | 'system'; id: string | null };
  action: string;
  entityType: string;
  entityId?: string | null;
  before?: unknown;
  after?: unknown;
  meta?: Record<string, unknown>;
}

/**
 * Append an audit record. Call it with the same transaction handle as the change it describes, so
 * the change and its trail commit (or roll back) together. Never put PINs, passwords or tokens in it.
 */
export async function writeAudit(db: DbOrTx, entry: AuditEntry): Promise<void> {
  await db.insert(auditLogs).values({
    outletId: entry.outletId,
    actorType: entry.actor.type,
    actorId: entry.actor.id,
    action: entry.action,
    entityType: entry.entityType,
    entityId: entry.entityId ?? null,
    before: entry.before ?? null,
    after: entry.after ?? null,
    meta: entry.meta ?? null,
  });
}
