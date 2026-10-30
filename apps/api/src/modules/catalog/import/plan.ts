import type {
  ProductImportAction,
  ProductImportColumn,
  ProductImportRowError,
  ProductImportRowErrorCode,
} from '@kelola-kasir/contracts';
import type { RawCell, RawRow } from './file.js';

const MAX_NAME = 60;
const MAX_CATEGORY = 40;
const MAX_PRICE = 1_000_000_000;
const TRUE_WORDS = new Set(['ya', 'y', 'yes', 'true', '1']);
const FALSE_WORDS = new Set(['tidak', 't', 'no', 'false', '0']);

export interface ExistingProduct {
  id: string;
  name: string;
  categoryId: string;
  price: number;
  isFavorite: boolean;
  isActive: boolean;
}

export interface ExistingCategory {
  id: string;
  name: string;
}

export interface PlanChange {
  field: 'price' | 'category' | 'is_favorite' | 'is_active';
  before: number | string | boolean;
  after: number | string | boolean;
}

export interface PlanRow {
  row: number;
  action: ProductImportAction;
  name: string | null;
  category: string | null;
  price: number | null;
  is_favorite: boolean | null;
  is_active: boolean | null;
  product_id: string | null;
  category_is_new: boolean;
  changes: PlanChange[];
  errors: ProductImportRowError[];
  /** Existing category id, or `null` when the category is created by this import. */
  categoryId: string | null;
  categoryKey: string | null;
  priceBefore: number | null;
}

export interface ImportPlan {
  rows: PlanRow[];
  /** New category names in file order (normalized spelling of the first mention). */
  newCategories: string[];
  summary: { total: number; create: number; update: number; unchanged: number; error: number };
}

/** NFC, NBSP → space, trim and collapse whitespace. */
export function normalizeText(value: string): string {
  return value.normalize('NFC').replace(/\s+/g, ' ').trim();
}

export const nameKey = (normalized: string): string => normalized.toLowerCase();

const err = (
  column: ProductImportColumn | null,
  code: ProductImportRowErrorCode,
  message: string,
): ProductImportRowError => ({ column, code, message });

type Parsed<T> = { ok: true; value: T } | { ok: false; error: ProductImportRowError };

const isFormula = (c: RawCell | undefined): c is { formula: true } =>
  typeof c === 'object' && c !== null && !(c instanceof Date) && 'formula' in c;

const formulaError = (column: ProductImportColumn) =>
  err(
    column,
    'FORMULA_NOT_ALLOWED',
    `Kolom ${column} berisi rumus tanpa hasil. Salin sel lalu tempel sebagai nilai (Paste Values).`,
  );

function parseText(
  column: 'nama' | 'kategori',
  cell: RawCell | undefined,
  max: number,
): Parsed<string> {
  if (isFormula(cell)) return { ok: false, error: formulaError(column) };
  if (cell instanceof Date) {
    return {
      ok: false,
      error: err(column, 'UNSAFE_TEXT', `Kolom ${column} harus berisi teks, bukan tanggal.`),
    };
  }
  const text = cell === null || cell === undefined ? '' : normalizeText(String(cell));
  if (!text) return { ok: false, error: err(column, 'REQUIRED', `Kolom ${column} wajib diisi.`) };
  if ([...text].length > max) {
    return {
      ok: false,
      error: err(column, 'TOO_LONG', `Kolom ${column} maksimal ${max} karakter.`),
    };
  }
  if (/^[=+\-@]/.test(text)) {
    return {
      ok: false,
      error: err(
        column,
        'UNSAFE_TEXT',
        `Kolom ${column} tidak boleh diawali tanda = + - atau @. Hapus tandanya.`,
      ),
    };
  }
  return { ok: true, value: text };
}

const PRICE_HINT = 'Harga harus angka bulat, contoh 15000 atau Rp15.000';

export function parsePrice(cell: RawCell | undefined): Parsed<number> {
  if (isFormula(cell)) return { ok: false, error: formulaError('harga') };
  const invalid = { ok: false, error: err('harga', 'INVALID_PRICE', PRICE_HINT) } as const;
  if (cell instanceof Date || typeof cell === 'boolean') return invalid;
  if (typeof cell === 'number') {
    return Number.isInteger(cell) && cell >= 0 && cell <= MAX_PRICE
      ? { ok: true, value: cell }
      : invalid;
  }
  let text = cell === null || cell === undefined ? '' : normalizeText(cell).replace(/\s+/g, '');
  if (!text) return { ok: false, error: err('harga', 'REQUIRED', 'Kolom harga wajib diisi.') };
  text = text.replace(/^rp\.?/i, '').replace(/(,00|,-)$/, '');
  if (!/^\d+$/.test(text) && !/^\d{1,3}(\.\d{3})+$/.test(text)) return invalid;
  const value = Number(text.replaceAll('.', ''));
  return Number.isSafeInteger(value) && value <= MAX_PRICE ? { ok: true, value } : invalid;
}

function parseBoolean(
  column: 'favorit' | 'aktif',
  cell: RawCell | undefined,
): Parsed<boolean | null> {
  if (isFormula(cell)) return { ok: false, error: formulaError(column) };
  if (cell === null || cell === undefined) return { ok: true, value: null };
  if (typeof cell === 'boolean') return { ok: true, value: cell };
  const word = cell instanceof Date ? '' : normalizeText(String(cell)).toLowerCase();
  if (word === '') return { ok: true, value: null };
  if (TRUE_WORDS.has(word)) return { ok: true, value: true };
  if (FALSE_WORDS.has(word)) return { ok: true, value: false };
  return {
    ok: false,
    error: err(column, 'INVALID_BOOLEAN', `Kolom ${column} harus diisi "ya" atau "tidak".`),
  };
}

/**
 * Validate every row and match it with the outlet's live catalog (ADR-0018 §5–§6).
 * Pure: the caller loads `products`/`categories` (soft-deleted rows excluded) and decides what to do with the plan.
 */
export function buildPlan(
  rawRows: RawRow[],
  products: ExistingProduct[],
  categories: ExistingCategory[],
  allCategoryNames: ReadonlyMap<string, string> = new Map(categories.map((c) => [c.id, c.name])),
): ImportPlan {
  const productsByKey = new Map<string, ExistingProduct[]>();
  for (const p of products) {
    const key = nameKey(normalizeText(p.name));
    productsByKey.set(key, [...(productsByKey.get(key) ?? []), p]);
  }
  // `categories` must be sorted by sort_order, created_at, id: the first match wins.
  const categoriesByKey = new Map<string, ExistingCategory>();
  for (const c of categories) {
    const key = nameKey(normalizeText(c.name));
    if (!categoriesByKey.has(key)) categoriesByKey.set(key, c);
  }

  const rows: PlanRow[] = rawRows.map((raw) => {
    const errs: ProductImportRowError[] = [];
    const take = <T>(p: Parsed<T>): T | null => {
      if (p.ok) return p.value;
      errs.push(p.error);
      return null;
    };
    const name = take(parseText('nama', raw.cells.nama, MAX_NAME));
    const category = take(parseText('kategori', raw.cells.kategori, MAX_CATEGORY));
    const price = take(parsePrice(raw.cells.harga));
    const favorite = take(parseBoolean('favorit', raw.cells.favorit));
    const active = take(parseBoolean('aktif', raw.cells.aktif));
    return {
      row: raw.row,
      action: 'error',
      name: name ?? displayText(raw.cells.nama, MAX_NAME),
      category: category ?? displayText(raw.cells.kategori, MAX_CATEGORY),
      price,
      is_favorite: favorite,
      is_active: active,
      product_id: null,
      category_is_new: false,
      changes: [],
      errors: errs,
      categoryId: null,
      categoryKey: category === null ? null : nameKey(category),
      priceBefore: null,
    };
  });

  // Same name twice in the file: every such row is an error.
  const byName = new Map<string, PlanRow[]>();
  for (const r of rows) {
    if (
      r.name === null ||
      r.errors.some((e) => e.column === 'nama' && e.code !== 'DUPLICATE_IN_FILE')
    ) {
      continue;
    }
    const key = nameKey(r.name);
    byName.set(key, [...(byName.get(key) ?? []), r]);
  }
  for (const group of byName.values()) {
    if (group.length < 2) continue;
    group.forEach((r, i) => {
      const other = i === 0 ? group[1] : group[0];
      r.errors.push(
        err(
          'nama',
          'DUPLICATE_IN_FILE',
          `Nama sama dengan baris ${other?.row ?? 0}. Gabungkan jadi satu baris.`,
        ),
      );
    });
  }

  const newCategories = new Map<string, string>();
  for (const r of rows) {
    if (r.errors.length > 0 || r.name === null || r.category === null || r.price === null) continue;
    const matches = productsByKey.get(nameKey(r.name)) ?? [];
    if (matches.length > 1) {
      r.errors.push(
        err(
          'nama',
          'AMBIGUOUS_MATCH',
          'Ada lebih dari satu produk dengan nama ini di toko. Rapikan dulu di halaman Produk.',
        ),
      );
      continue;
    }
    const catKey = nameKey(r.category);
    const existingCategory = categoriesByKey.get(catKey);
    r.categoryId = existingCategory?.id ?? null;
    r.category_is_new = !existingCategory;
    const existing = matches[0];
    if (!existing) {
      r.action = 'create';
      r.is_favorite = r.is_favorite ?? false;
      r.is_active = r.is_active ?? true;
    } else {
      r.product_id = existing.id;
      r.priceBefore = existing.price;
      r.is_favorite = r.is_favorite ?? existing.isFavorite;
      r.is_active = r.is_active ?? existing.isActive;
      if (existing.price !== r.price) {
        r.changes.push({ field: 'price', before: existing.price, after: r.price });
      }
      if (existing.categoryId !== r.categoryId) {
        r.changes.push({
          field: 'category',
          before: allCategoryNames.get(existing.categoryId) ?? '',
          after: existingCategory?.name ?? r.category,
        });
      }
      if (existing.isFavorite !== r.is_favorite) {
        r.changes.push({ field: 'is_favorite', before: existing.isFavorite, after: r.is_favorite });
      }
      if (existing.isActive !== r.is_active) {
        r.changes.push({ field: 'is_active', before: existing.isActive, after: r.is_active });
      }
      r.action = r.changes.length > 0 ? 'update' : 'unchanged';
    }
    if (r.category_is_new && !newCategories.has(catKey)) newCategories.set(catKey, r.category);
  }

  const summary = { total: rows.length, create: 0, update: 0, unchanged: 0, error: 0 };
  for (const r of rows) {
    if (r.errors.length > 0) {
      r.action = 'error';
      r.product_id = null;
      r.category_is_new = false;
      r.changes = [];
    }
    summary[r.action] += 1;
  }
  return { rows, newCategories: [...newCategories.values()], summary };
}

/** Echoed text of a cell that failed validation, clipped so the response never mirrors big cells. */
function displayText(cell: RawCell | undefined, max: number): string | null {
  if (cell === null || cell === undefined || typeof cell === 'object') return null;
  const text = normalizeText(String(cell));
  return text ? [...text].slice(0, max).join('') : null;
}
