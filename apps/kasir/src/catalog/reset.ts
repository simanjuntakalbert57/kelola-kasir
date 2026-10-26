import { META } from '../db/meta';
import type { Db } from '../db/types';

/**
 * Re-pairing wipes the catalog, store settings and sync cursor so the next pull is a full snapshot
 * of the (possibly different) outlet. Unsent sales, history and the outbox are real work and stay.
 */
export async function resetCatalog(db: Db): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.run('DELETE FROM products');
    await tx.run('DELETE FROM categories');
    await tx.run('DELETE FROM meta WHERE key IN (?, ?)', [META.cursor, META.settings]);
  });
}
