import type { categories, products } from '../../db/schema.js';

export type CategoryRow = typeof categories.$inferSelect;
export type ProductRow = typeof products.$inferSelect;

export function toCategory(row: Pick<CategoryRow, 'id' | 'name' | 'sortOrder'>) {
  return { id: row.id, name: row.name, sort_order: row.sortOrder };
}

export function toProduct(row: ProductRow) {
  return {
    id: row.id,
    category_id: row.categoryId,
    name: row.name,
    image_url: row.imageUrl,
    price: row.price,
    is_active: row.isActive,
    is_sold_out: row.isSoldOut,
    is_favorite: row.isFavorite,
    sort_order: row.sortOrder,
    updated_at: row.updatedAt.toISOString(),
  };
}
