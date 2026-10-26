import type { Category, Product } from '@kelola-kasir/contracts';
import { get, type Db } from '../db/types';
import { uuidv7 } from '../lib/uuid';
import { enqueueMutation } from '../sync/outbox';

export interface CatalogProduct {
  id: string;
  categoryId: string;
  name: string;
  imageUrl: string | null;
  price: number;
}

export interface CatalogQuery {
  /** `'favorit'` = best sellers on this device; otherwise a category id; omitted = everything. */
  category?: string | 'favorit';
  search?: string;
}

export const FAVORITE_LIMIT = 8;
/** Look-back window for "Favorit": sales from the last 30 days on this device. */
const FAVORITE_WINDOW_MS = 30 * 24 * 3600 * 1000;

interface ProductRow {
  id: string;
  category_id: string;
  name: string;
  image_url: string | null;
  price: number;
}

const toProduct = (r: ProductRow): CatalogProduct => ({
  id: r.id,
  categoryId: r.category_id,
  name: r.name,
  imageUrl: r.image_url,
  price: r.price,
});

/** Sold-out and deactivated products never reach the cashier's grid (M-6). */
const VISIBLE = 'p.is_active = 1 AND p.is_sold_out = 0';

export function createCatalogRepository(db: Db, now: () => number = Date.now) {
  return {
    async applyChanges(changes: {
      categories?: readonly Category[];
      products?: readonly Product[];
      deleted?: readonly { entity: string; id: string }[];
    }): Promise<void> {
      await db.transaction(async (tx) => {
        // A sold-out toggle still waiting in the outbox wins over the server's older value.
        const queued = new Map<string, boolean>();
        const rows = await tx.all<{ payload: string }>(
          "SELECT payload FROM outbox WHERE type = 'product.mark_sold_out' AND state = 'pending' ORDER BY seq",
        );
        for (const r of rows) {
          const m = JSON.parse(r.payload) as { product_id: string; is_sold_out: boolean };
          queued.set(m.product_id, m.is_sold_out);
        }
        for (const c of changes.categories ?? []) {
          await tx.run(
            `INSERT INTO categories (id, name, sort_order) VALUES (?, ?, ?)
             ON CONFLICT(id) DO UPDATE SET name = excluded.name, sort_order = excluded.sort_order`,
            [c.id, c.name, c.sort_order],
          );
        }
        for (const p of changes.products ?? []) {
          await tx.run(
            `INSERT INTO products (id, category_id, name, image_url, price, is_active, is_sold_out, sort_order)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(id) DO UPDATE SET category_id = excluded.category_id, name = excluded.name,
               image_url = excluded.image_url, price = excluded.price, is_active = excluded.is_active,
               is_sold_out = excluded.is_sold_out, sort_order = excluded.sort_order`,
            [
              p.id,
              p.category_id,
              p.name,
              p.image_url ?? null,
              p.price,
              p.is_active ? 1 : 0,
              (queued.get(p.id) ?? p.is_sold_out) ? 1 : 0,
              p.sort_order ?? 0,
            ],
          );
        }
        for (const d of changes.deleted ?? []) {
          if (d.entity === 'product') await tx.run('DELETE FROM products WHERE id = ?', [d.id]);
          if (d.entity === 'category') {
            await tx.run('DELETE FROM categories WHERE id = ?', [d.id]);
          }
        }
      });
    },

    async listCategories(): Promise<Category[]> {
      const rows = await db.all<{ id: string; name: string; sort_order: number }>(
        `SELECT c.id, c.name, c.sort_order FROM categories c
         WHERE EXISTS (SELECT 1 FROM products p WHERE p.category_id = c.id AND ${VISIBLE})
         ORDER BY c.sort_order, c.name`,
      );
      return rows;
    },

    async listProducts(query: CatalogQuery = {}): Promise<CatalogProduct[]> {
      const where = [VISIBLE];
      const params: (string | number)[] = [];
      const search = query.search?.trim();
      if (search) {
        where.push("p.name LIKE ? ESCAPE '\\'");
        params.push(`%${search.replace(/[\\%_]/g, '\\$&')}%`);
      }
      if (query.category === 'favorit') {
        const since = new Date(now() - FAVORITE_WINDOW_MS).toISOString();
        const rows = await db.all<ProductRow>(
          `SELECT p.id, p.category_id, p.name, p.image_url, p.price,
                  COALESCE(s.sold, 0) AS sold
           FROM products p
           LEFT JOIN (SELECT product_id, SUM(quantity) AS sold FROM transaction_items
                      WHERE created_at >= ? GROUP BY product_id) s ON s.product_id = p.id
           WHERE ${where.join(' AND ')}
           ORDER BY sold DESC, p.sort_order, p.name LIMIT ${FAVORITE_LIMIT}`,
          [since, ...params],
        );
        return rows.map(toProduct);
      }
      if (query.category) {
        where.push('p.category_id = ?');
        params.push(query.category);
      }
      const rows = await db.all<ProductRow>(
        `SELECT p.id, p.category_id, p.name, p.image_url, p.price FROM products p
         WHERE ${where.join(' AND ')} ORDER BY p.sort_order, p.name`,
        params,
      );
      return rows.map(toProduct);
    },

    /** Sold-out menu, so the cashier can bring an item back (it is hidden from the grid). */
    async listSoldOut(): Promise<CatalogProduct[]> {
      const rows = await db.all<ProductRow>(
        `SELECT id, category_id, name, image_url, price FROM products
         WHERE is_active = 1 AND is_sold_out = 1 ORDER BY name`,
      );
      return rows.map(toProduct);
    },

    /** Flips availability locally at once and queues `product.mark_sold_out` for the server (M-14). */
    async setSoldOut(
      productId: string,
      soldOut: boolean,
      employeeId: string | null,
      at: Date = new Date(),
    ): Promise<void> {
      await db.transaction(async (tx) => {
        await tx.run('UPDATE products SET is_sold_out = ? WHERE id = ?', [
          soldOut ? 1 : 0,
          productId,
        ]);
        await enqueueMutation(tx, {
          id: uuidv7(at.getTime()),
          type: 'product.mark_sold_out',
          employeeId,
          clientCreatedAt: at.toISOString(),
          payload: { product_id: productId, is_sold_out: soldOut },
        });
      });
    },

    async productCount(): Promise<number> {
      const row = await get<{ n: number }>(db, 'SELECT COUNT(*) AS n FROM products');
      return row?.n ?? 0;
    },
  };
}

export type CatalogRepository = ReturnType<typeof createCatalogRepository>;
