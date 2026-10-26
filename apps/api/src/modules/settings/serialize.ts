import { eq } from 'drizzle-orm';
import type { DbOrTx } from '../../db/client.js';
import { outletSettings, outlets } from '../../db/schema.js';

export type OutletRow = typeof outlets.$inferSelect;
export type SettingsRow = typeof outletSettings.$inferSelect;

export function toSettings(outlet: OutletRow, row: SettingsRow) {
  return {
    outlet: { id: outlet.id, code: outlet.code, name: outlet.name, timezone: outlet.timezone },
    display_name: row.displayName,
    address: row.address,
    phone: row.phone,
    logo_url: row.logoUrl,
    receipt_header: row.receiptHeader,
    receipt_footer: row.receiptFooter,
    qris_mode: row.qrisMode as 'static' | 'dynamic',
    qris_static_payload: row.qrisStaticPayload,
    qris_static_image_url: row.qrisStaticImageUrl,
    qris_merchant_name: row.qrisMerchantName,
    qris_embed_amount: row.qrisEmbedAmount,
    offline_login_enabled: row.offlineLoginEnabled,
    quick_cash_amounts: row.quickCashAmounts,
  };
}

/** Settings row of an outlet; created on first use so older outlets without one keep working. */
export async function loadSettings(
  db: DbOrTx,
  outletId: string,
): Promise<{ outlet: OutletRow; settings: SettingsRow }> {
  const [outlet] = await db.select().from(outlets).where(eq(outlets.id, outletId)).limit(1);
  if (!outlet) throw new Error(`outlet ${outletId} missing`);
  let [settings] = await db
    .select()
    .from(outletSettings)
    .where(eq(outletSettings.outletId, outletId))
    .limit(1);
  if (!settings) {
    [settings] = await db
      .insert(outletSettings)
      .values({ outletId, displayName: outlet.name })
      .onConflictDoNothing()
      .returning();
    if (!settings) {
      [settings] = await db
        .select()
        .from(outletSettings)
        .where(eq(outletSettings.outletId, outletId))
        .limit(1);
    }
  }
  if (!settings) throw new Error(`settings of outlet ${outletId} missing`);
  return { outlet, settings };
}
