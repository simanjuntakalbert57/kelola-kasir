import { and, asc, eq } from 'drizzle-orm';
import type { UserPrincipal } from '../../context.js';
import type { DbOrTx } from '../../db/client.js';
import { outletMembers, outlets } from '../../db/schema.js';
import { errors } from '../../errors.js';

export interface ScopedOutlet {
  id: string;
  code: string;
  name: string;
  timezone: string;
  operationsStartedOn: string | null;
}

const columns = {
  id: outlets.id,
  code: outlets.code,
  name: outlets.name,
  timezone: outlets.timezone,
  operationsStartedOn: outlets.operationsStartedOn,
};

/**
 * Outlets a request with `outlet_scope` works on (ADR-0020 §2), ordered by code. `current` is the active outlet of
 * the token. `all` is every outlet where the user is owner right now (read from `outlet_members`, not from the
 * token); a caller whose role in the active outlet is `manager` gets `403`.
 */
export async function resolveOutletScope(
  db: DbOrTx,
  principal: UserPrincipal,
  scope: 'current' | 'all',
): Promise<ScopedOutlet[]> {
  if (scope === 'all') {
    if (principal.role !== 'owner') {
      throw errors.forbidden('outlet_scope=all requires the owner role');
    }
    const rows = await db
      .select(columns)
      .from(outletMembers)
      .innerJoin(outlets, eq(outlets.id, outletMembers.outletId))
      .where(and(eq(outletMembers.userId, principal.id), eq(outletMembers.role, 'owner')))
      .orderBy(asc(outlets.code));
    if (rows.length > 0) return rows;
  }
  const rows = await db.select(columns).from(outlets).where(eq(outlets.id, principal.outletId));
  if (rows.length === 0) throw errors.forbidden('Outlet not found');
  return rows;
}
