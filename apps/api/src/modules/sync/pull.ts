import { and, asc, desc, eq, gt, isNull } from 'drizzle-orm';
import type { Database } from '../../db/client.js';
import {
  categories,
  employees,
  outletSettings,
  products,
  shifts,
  transactions,
} from '../../db/schema.js';
import { errors } from '../../errors.js';
import { toCategory, toProduct } from '../catalog/serialize.js';
import { currentSyncSeq, encodeSyncCursor } from '../catalog/routes.js';
import { loadSettings, toSettings } from '../settings/serialize.js';
import { toShiftDtos } from '../shifts/summary.js';
import { z } from 'zod';

export const MAX_PULL = 500;

export function decodeSyncCursor(cursor: string): number {
  try {
    const parsed = z
      .object({ s: z.number().int().min(0) })
      .parse(JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')));
    return parsed.s;
  } catch {
    throw errors.validation([{ path: 'cursor', message: 'Invalid cursor' }]);
  }
}

type Change =
  | { seq: number; kind: 'category'; row: typeof categories.$inferSelect }
  | { seq: number; kind: 'product'; row: typeof products.$inferSelect }
  | { seq: number; kind: 'employee'; row: typeof employees.$inferSelect }
  | { seq: number; kind: 'settings'; row: typeof outletSettings.$inferSelect };

/**
 * Incremental catalog/config changes of an outlet since `cursor` (ADR-0008). Without a cursor the
 * result is a full snapshot without tombstones. Every change carries a `catalog_seq` value; the
 * cursor is the highest one delivered. Rows are upserted by id on the client, so redelivery is
 * harmless. (A row whose writer commits after a higher sequence value was already delivered can be
 * missed; the owner edits rarely and sequentially, so the MVP accepts that.)
 */
export async function pullChanges(
  db: Database,
  input: { outletId: string; deviceId: string; cursor: string | undefined; limit: number },
) {
  const after = input.cursor === undefined ? 0 : decodeSyncCursor(input.cursor);
  const full = input.cursor === undefined;
  const snapshotSeq = await currentSyncSeq(db);
  const take = input.limit + 1;
  const { outletId } = input;

  const [cats, prods, emps, sets] = await Promise.all([
    db
      .select()
      .from(categories)
      .where(
        and(
          eq(categories.outletId, outletId),
          gt(categories.updatedSeq, after),
          full ? isNull(categories.deletedAt) : undefined,
        ),
      )
      .orderBy(asc(categories.updatedSeq))
      .limit(take),
    db
      .select()
      .from(products)
      .where(
        and(
          eq(products.outletId, outletId),
          gt(products.updatedSeq, after),
          full ? isNull(products.deletedAt) : undefined,
        ),
      )
      .orderBy(asc(products.updatedSeq))
      .limit(take),
    db
      .select()
      .from(employees)
      .where(and(eq(employees.outletId, outletId), gt(employees.updatedSeq, after)))
      .orderBy(asc(employees.updatedSeq))
      .limit(take),
    db
      .select()
      .from(outletSettings)
      .where(and(eq(outletSettings.outletId, outletId), gt(outletSettings.updatedSeq, after)))
      .limit(1),
  ]);

  const merged: Change[] = [
    ...cats.map((row) => ({ seq: row.updatedSeq, kind: 'category' as const, row })),
    ...prods.map((row) => ({ seq: row.updatedSeq, kind: 'product' as const, row })),
    ...emps.map((row) => ({ seq: row.updatedSeq, kind: 'employee' as const, row })),
    ...sets.map((row) => ({ seq: row.updatedSeq, kind: 'settings' as const, row })),
  ].sort((a, b) => a.seq - b.seq);
  const hasMore = merged.length > input.limit;
  const page = merged.slice(0, input.limit);
  const last = page[page.length - 1];
  const nextSeq = last ? last.seq : full ? snapshotSeq : after;

  const { outlet, settings } = await loadSettings(db, outletId);
  const changes: {
    categories: ReturnType<typeof toCategory>[];
    products: ReturnType<typeof toProduct>[];
    employees: { id: string; name: string; is_active: boolean; pin_hash: string | null }[];
    settings: ReturnType<typeof toSettings> | null;
    deleted: { entity: 'category' | 'product'; id: string }[];
  } = { categories: [], products: [], employees: [], settings: null, deleted: [] };

  for (const change of page) {
    switch (change.kind) {
      case 'category':
        if (change.row.deletedAt) changes.deleted.push({ entity: 'category', id: change.row.id });
        else changes.categories.push(toCategory(change.row));
        break;
      case 'product':
        if (change.row.deletedAt) changes.deleted.push({ entity: 'product', id: change.row.id });
        else changes.products.push(toProduct(change.row));
        break;
      case 'employee':
        changes.employees.push({
          id: change.row.id,
          name: change.row.name,
          is_active: change.row.isActive,
          // PIN hashes only go to paired devices when the owner enabled offline login.
          pin_hash: settings.offlineLoginEnabled && change.row.isActive ? change.row.pinHash : null,
        });
        break;
      case 'settings':
        changes.settings = toSettings(outlet, change.row);
        break;
    }
  }

  const [open] = await db
    .select()
    .from(shifts)
    .where(and(eq(shifts.outletId, outletId), eq(shifts.status, 'open')))
    .limit(1);
  const [currentShift] = open ? await toShiftDtos(db, [open]) : [];
  const [latest] = await db
    .select({ number: transactions.number })
    .from(transactions)
    .where(eq(transactions.deviceId, input.deviceId))
    .orderBy(desc(transactions.number))
    .limit(1);

  return {
    next_cursor: encodeSyncCursor(nextSeq),
    has_more: hasMore,
    changes,
    current_shift: currentShift ?? null,
    // Revoked devices are turned away with 401 DEVICE_REVOKED before reaching this point.
    device_revoked: false,
    last_number: latest?.number ?? null,
  };
}
