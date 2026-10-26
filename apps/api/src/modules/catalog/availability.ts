import { and, eq, isNull } from 'drizzle-orm';
import type { DbOrTx } from '../../db/client.js';
import { products } from '../../db/schema.js';
import { writeAudit } from '../audit/audit.js';
import type { ProductRow } from './serialize.js';

export interface AvailabilityActor {
  type: 'user' | 'employee' | 'device';
  id: string | null;
}

/**
 * Set the sold-out flag of a product (P-11). Returns the product, or undefined when it does not
 * exist in the outlet. `changed` is false when the product already had the requested value.
 */
export async function setSoldOut(
  tx: DbOrTx,
  input: {
    outletId: string;
    productId: string;
    isSoldOut: boolean;
    actor: AvailabilityActor;
    source: 'api' | 'sync';
  },
): Promise<{ product: ProductRow; changed: boolean } | undefined> {
  const [current] = await tx
    .select()
    .from(products)
    .where(
      and(
        eq(products.id, input.productId),
        eq(products.outletId, input.outletId),
        isNull(products.deletedAt),
      ),
    )
    .for('update')
    .limit(1);
  if (!current) return undefined;
  if (current.isSoldOut === input.isSoldOut) return { product: current, changed: false };
  const [updated] = await tx
    .update(products)
    .set({ isSoldOut: input.isSoldOut })
    .where(eq(products.id, current.id))
    .returning();
  if (!updated) return undefined;
  await writeAudit(tx, {
    outletId: input.outletId,
    actor: input.actor,
    action: 'product.availability_changed',
    entityType: 'product',
    entityId: current.id,
    before: { is_sold_out: current.isSoldOut },
    after: { is_sold_out: updated.isSoldOut },
    meta: { source: input.source },
  });
  return { product: updated, changed: true };
}
