import { createHash } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { loadConfig } from '../config.js';
import { createDb } from '../db/client.js';
import { pinFingerprint } from '../lib/crypto.js';
import { hashSecret } from '../lib/passwords.js';

/**
 * QA seed for the multi-branch dashboard (DEAR-160). Idempotent, additive, never edits or deletes existing rows.
 * Touches ONLY the QA owner's account: adds a second branch (code QAM2, name "... (uji)"), a manager account in
 * that branch, and per branch a "(uji)" employee, device, category, two products and a closed shift with 3 paid
 * transactions today (2 QRIS + 1 cash). Rows are keyed by deterministic ids, so a re-run on the same WIB day changes
 * nothing; a re-run on a later day adds that day's transactions (so "Hari ini" is never empty).
 *
 *   QA_OWNER_EMAIL            existing owner account of the QA outlet (required)
 *   QA_MANAGER_EMAIL          manager account to create in the second branch (required)
 *   QA_MANAGER_PASSWORD       min 12 chars; only used when the manager does not exist yet (required then)
 *   QA_PRIMARY_OUTLET_CODE    default QAMED
 *   QA_SECOND_OUTLET_CODE     default QAM2
 *   QA_DRY_RUN=1              run everything, then roll back
 */
const required = (name: string): string => {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is required`);
  return v;
};
const uuid = (...parts: string[]): string => {
  const h = createHash('sha256')
    .update(`kk-qa-seed:${parts.join(':')}`)
    .digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
};

interface Sale {
  product: 'alpukat' | 'jeruk';
  qty: number;
  method: 'cash' | 'qris';
}
const PRODUCTS = {
  alpukat: ['Jus Alpukat (uji)', 15_000],
  jeruk: ['Jus Jeruk (uji)', 12_000],
} as const;
/** Per branch, per day. Primary: 57.000 (cash 15.000, QRIS 42.000, 4 cup). Second: 75.000 (cash 24.000, QRIS 51.000, 6 cup). */
const SALES: Record<'primary' | 'second', Sale[]> = {
  primary: [
    { product: 'alpukat', qty: 2, method: 'qris' },
    { product: 'jeruk', qty: 1, method: 'qris' },
    { product: 'alpukat', qty: 1, method: 'cash' },
  ],
  second: [
    { product: 'jeruk', qty: 3, method: 'qris' },
    { product: 'alpukat', qty: 1, method: 'qris' },
    { product: 'jeruk', qty: 2, method: 'cash' },
  ],
};

async function main(): Promise<void> {
  const ownerEmail = required('QA_OWNER_EMAIL').trim().toLowerCase();
  const managerEmail = required('QA_MANAGER_EMAIL').trim().toLowerCase();
  const primaryCode = (process.env['QA_PRIMARY_OUTLET_CODE'] ?? 'QAMED').toUpperCase();
  const secondCode = (process.env['QA_SECOND_OUTLET_CODE'] ?? 'QAM2').toUpperCase();
  if (!/^[A-Z0-9]{2,6}$/.test(secondCode))
    throw new Error('QA_SECOND_OUTLET_CODE must be 2-6 letters or digits');
  const config = loadConfig();
  const handle = createDb(config.databaseUrl);
  const dryRun = process.env['QA_DRY_RUN'] === '1';
  try {
    await handle.db
      .transaction(async (tx) => {
        const rows = async <T>(q: ReturnType<typeof sql>) => (await tx.execute(q)).rows as T[];
        const [owner] = await rows<{ id: string }>(
          sql`SELECT id FROM users WHERE email = ${ownerEmail} AND is_active`,
        );
        if (!owner) throw new Error(`no active user ${ownerEmail}`);
        const [primary] = await rows<{ id: string }>(sql`
        SELECT o.id FROM outlets o JOIN outlet_members m ON m.outlet_id = o.id
         WHERE o.code = ${primaryCode} AND m.user_id = ${owner.id} AND m.role = 'owner'`);
        if (!primary) throw new Error(`${ownerEmail} is not an owner of outlet ${primaryCode}`);

        // Second branch (same shape as ops/vps/create-branch-outlet.sql); reuse it on re-run, but only if it is ours.
        let [second] = await rows<{ id: string; name: string }>(
          sql`SELECT id, name FROM outlets WHERE code = ${secondCode}`,
        );
        if (second) {
          const [mine] = await rows<{ n: number }>(sql`
          SELECT count(*)::int AS n FROM outlet_members WHERE outlet_id = ${second.id} AND user_id = ${owner.id} AND role = 'owner'`);
          if (!mine?.n || !second.name.includes('(uji)')) {
            throw new Error(
              `outlet ${secondCode} exists but is not a QA test branch of ${ownerEmail}; refusing`,
            );
          }
        } else {
          const name = 'Cabang Uji QA (uji)';
          const [created] = await rows<{ id: string; name: string }>(
            sql`INSERT INTO outlets (code, name) VALUES (${secondCode}, ${name}) RETURNING id, name`,
          );
          if (!created) throw new Error('failed to create outlet');
          second = created;
          await tx.execute(
            sql`INSERT INTO outlet_settings (outlet_id, display_name) VALUES (${second.id}, ${name})`,
          );
          await tx.execute(
            sql`INSERT INTO outlet_members (outlet_id, user_id, role) VALUES (${second.id}, ${owner.id}, 'owner')`,
          );
          await tx.execute(sql`SELECT kk_seed_expense_categories(${second.id})`);
          await tx.execute(sql`
          INSERT INTO audit_logs (outlet_id, actor_type, action, entity_type, entity_id, after, meta)
          VALUES (${second.id}, 'system', 'outlet.created', 'outlet', ${second.id},
                  ${JSON.stringify({ code: secondCode, name })}::jsonb, '{"script":"seed-qa-multibranch"}'::jsonb)`);
        }
        if (!second) throw new Error('unreachable');
        const secondId = second.id;

        // Manager of the second branch only.
        const [existingManager] = await rows<{ id: string }>(
          sql`SELECT id FROM users WHERE email = ${managerEmail}`,
        );
        let managerId = existingManager?.id;
        if (!managerId) {
          const password = required('QA_MANAGER_PASSWORD');
          if (password.length < 12)
            throw new Error('QA_MANAGER_PASSWORD must be at least 12 characters');
          const hash = await hashSecret(password);
          [{ id: managerId }] = (await rows<{ id: string }>(sql`
          INSERT INTO users (email, password_hash, name) VALUES (${managerEmail}, ${hash}, 'Manager Uji QA (uji)') RETURNING id`)) as [
            { id: string },
          ];
        }
        await tx.execute(sql`
        INSERT INTO outlet_members (outlet_id, user_id, role) VALUES (${secondId}, ${managerId}, 'manager')
        ON CONFLICT (outlet_id, user_id) DO NOTHING`);

        const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(
          new Date(),
        );
        const yymmdd = day.slice(2).replace(/-/g, '');
        const pinHash = await hashSecret('135790');
        let added = 0;
        for (const [kind, outletId, code] of [
          ['primary', primary.id, primaryCode],
          ['second', secondId, secondCode],
        ] as const) {
          const key = (...p: string[]) => uuid(outletId, ...p);
          const employeeId = key('employee');
          const deviceId = key('device');
          const categoryId = key('category');
          await tx.execute(sql`
          INSERT INTO employees (id, outlet_id, name, pin_hash, pin_fingerprint)
          VALUES (${employeeId}, ${outletId}, 'Kasir Uji (uji)', ${pinHash}, ${pinFingerprint(config.pinFingerprintSecret, outletId, '135790')})
          ON CONFLICT (id) DO NOTHING`);
          // device codes are per outlet; "U01" cannot collide with the K01.. codes the pairing flow hands out
          await tx.execute(sql`
          INSERT INTO devices (id, outlet_id, code, name) VALUES (${deviceId}, ${outletId}, 'U01', 'HP Uji (uji)')
          ON CONFLICT (id) DO NOTHING`);
          await tx.execute(sql`
          INSERT INTO categories (id, outlet_id, name) VALUES (${categoryId}, ${outletId}, 'Uji (uji)')
          ON CONFLICT (id) DO NOTHING`);
          for (const [pk, [name, price]] of Object.entries(PRODUCTS)) {
            await tx.execute(sql`
            INSERT INTO products (id, outlet_id, category_id, name, price)
            VALUES (${key('product', pk)}, ${outletId}, ${categoryId}, ${name}, ${price}) ON CONFLICT (id) DO NOTHING`);
          }
          const sales = SALES[kind];
          const cash = sales
            .filter((s) => s.method === 'cash')
            .reduce((a, s) => a + PRODUCTS[s.product][1] * s.qty, 0);
          const qris = sales
            .filter((s) => s.method === 'qris')
            .reduce((a, s) => a + PRODUCTS[s.product][1] * s.qty, 0);
          const shiftId = key('shift', day);
          const shift = await tx.execute(sql`
          INSERT INTO shifts (id, outlet_id, opened_device_id, closed_device_id, opened_by, closed_by, status, opening_cash,
                              expected_cash, actual_cash, cash_difference, total_cash_sales, total_qris_sales, transaction_count,
                              opened_at, closed_at, closing_note)
          VALUES (${shiftId}, ${outletId}, ${deviceId}, ${deviceId}, ${employeeId}, ${employeeId}, 'closed', 100000,
                  ${100_000 + cash}, ${100_000 + cash}, 0, ${cash}, ${qris}, ${sales.length}, now(), now(), 'Data uji QA (uji)')
          ON CONFLICT (id) DO NOTHING`);
          if (shift.rowCount === 0) continue; // this day is already seeded for the branch
          for (const [i, s] of sales.entries()) {
            const [pname, price] = PRODUCTS[s.product];
            const total = price * s.qty;
            const txId = key('tx', day, String(i));
            const number = `${code}-U01-${yymmdd}-${String(9001 + i)}`;
            await tx.execute(sql`
            INSERT INTO transactions (id, outlet_id, shift_id, device_id, employee_id, number, status, payment_method,
                                      customer_label, subtotal, total, client_created_at, paid_at)
            VALUES (${txId}, ${outletId}, ${shiftId}, ${deviceId}, ${employeeId}, ${number}, 'paid', ${s.method},
                    'Data uji QA (uji)', ${total}, ${total}, now(), now())`);
            await tx.execute(sql`
            INSERT INTO transaction_items (id, transaction_id, product_id, product_name, unit_price, quantity, line_total)
            VALUES (${key('item', day, String(i))}, ${txId}, ${key('product', s.product)}, ${pname}, ${price}, ${s.qty}, ${total})`);
            await tx.execute(
              s.method === 'cash'
                ? sql`INSERT INTO payments (id, transaction_id, method, provider, status, amount, cash_tendered, cash_change, paid_at)
                    VALUES (${key('pay', day, String(i))}, ${txId}, 'cash', 'cash', 'paid', ${total}, ${total}, 0, now())`
                : sql`INSERT INTO payments (id, transaction_id, method, provider, status, amount, confirmation_mode, paid_at)
                    VALUES (${key('pay', day, String(i))}, ${txId}, 'qris', 'qris_static', 'paid', ${total}, 'manual', now())`,
            );
            added += 1;
          }
        }
        console.error(
          `${dryRun ? '[dry run, rolled back] ' : ''}seed ok: branch ${secondCode}, manager ${managerEmail}, ${added} transactions added for ${day}`,
        );
        if (dryRun) throw new RollbackSignal();
      })
      .catch((e: unknown) => {
        if (!(e instanceof RollbackSignal)) throw e;
      });
  } finally {
    await handle.close();
  }
}

class RollbackSignal extends Error {}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
