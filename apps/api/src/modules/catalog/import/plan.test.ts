import { describe, expect, it } from 'vitest';
import type { RawCell, RawRow } from './file.js';
import { buildPlan, parsePrice, type ExistingProduct } from './plan.js';

const NBSP = String.fromCodePoint(0xa0);

const row = (n: number, cells: Record<string, RawCell>): RawRow => ({
  row: n,
  cells: { nama: 'A', kategori: 'K', harga: '1000', ...cells },
});

const CATS = [
  { id: 'c1', name: 'Jus Buah' },
  { id: 'c2', name: 'Makanan' },
];
const product = (over: Partial<ExistingProduct> = {}): ExistingProduct => ({
  id: 'p1',
  name: 'Jus Jeruk',
  categoryId: 'c1',
  price: 15000,
  isFavorite: false,
  isActive: true,
  ...over,
});

describe('parsePrice', () => {
  it.each([
    ['15000', 15000],
    ['15.000', 15000],
    ['Rp15.000', 15000],
    ['rp.15.000', 15000],
    ['Rp 15.000,00', 15000],
    ['15000,-', 15000],
    ['1.234.567', 1234567],
    ['0', 0],
    ['  1 5000 ', 15000],
    [15000, 15000],
    ['1000000000', 1_000_000_000],
  ])('accepts %j', (input, expected) => {
    expect(parsePrice(input)).toEqual({ ok: true, value: expected });
  });

  it.each([
    '15,5',
    '15.5',
    '-1',
    '1.5000',
    'lima belas ribu',
    '1000000001',
    '15000.00',
    '1e3',
    'Rp',
    '12.34',
  ])('rejects %j as INVALID_PRICE', (input) => {
    const r = parsePrice(input);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('INVALID_PRICE');
  });

  it.each([15.5, -1, 1_000_000_001, true, new Date()])('rejects non-integer cell %j', (v) => {
    expect(parsePrice(v).ok).toBe(false);
  });

  it('requires a price and rejects formulas', () => {
    expect(parsePrice('')).toMatchObject({ ok: false, error: { code: 'REQUIRED' } });
    expect(parsePrice(null)).toMatchObject({ ok: false, error: { code: 'REQUIRED' } });
    expect(parsePrice({ formula: true })).toMatchObject({
      ok: false,
      error: { code: 'FORMULA_NOT_ALLOWED' },
    });
  });
});

describe('row validation', () => {
  const plan = (cells: Record<string, RawCell>) => buildPlan([row(2, cells)], [], CATS).rows[0];

  it.each([
    [{ nama: '' }, 'nama', 'REQUIRED'],
    [{ nama: 'x'.repeat(61) }, 'nama', 'TOO_LONG'],
    [{ nama: '=SUM(A1)' }, 'nama', 'UNSAFE_TEXT'],
    [{ nama: '+62' }, 'nama', 'UNSAFE_TEXT'],
    [{ nama: '-x' }, 'nama', 'UNSAFE_TEXT'],
    [{ nama: '@x' }, 'nama', 'UNSAFE_TEXT'],
    [{ kategori: null }, 'kategori', 'REQUIRED'],
    [{ kategori: 'k'.repeat(41) }, 'kategori', 'TOO_LONG'],
    [{ kategori: '=1' }, 'kategori', 'UNSAFE_TEXT'],
    [{ harga: 'abc' }, 'harga', 'INVALID_PRICE'],
    [{ favorit: 'mungkin' }, 'favorit', 'INVALID_BOOLEAN'],
    [{ aktif: 'ok' }, 'aktif', 'INVALID_BOOLEAN'],
    [{ nama: { formula: true } }, 'nama', 'FORMULA_NOT_ALLOWED'],
  ] as const)('%j -> %s %s', (cells, column, code) => {
    const r = plan(cells as Record<string, RawCell>);
    expect(r?.action).toBe('error');
    expect(r?.errors.map((e) => [e.column, e.code])).toEqual([[column, code]]);
  });

  it('accepts a 60 char name and normalizes spaces, NBSP and NFC', () => {
    const r = plan({ nama: `  Jus${NBSP}${NBSP} Mangga  `, kategori: ' Jus   Buah ' });
    expect(r?.name).toBe('Jus Mangga');
    expect(r?.category).toBe('Jus Buah');
    expect(plan({ nama: 'x'.repeat(60) })?.errors).toEqual([]);
    expect(plan({ nama: 'Café' })?.name).toBe('Café');
  });

  it.each([
    ['ya', true],
    ['Y', true],
    ['YES', true],
    ['true', true],
    ['1', true],
    [true, true],
    ['tidak', false],
    ['T', false],
    ['no', false],
    ['False', false],
    ['0', false],
    [false, false],
  ] as const)('reads boolean %j', (input, expected) => {
    expect(plan({ favorit: input })?.is_favorite).toBe(expected);
  });

  it('does not echo long cell text in errors', () => {
    const r = plan({ nama: 'x'.repeat(500) });
    expect(r?.name).toHaveLength(60);
  });

  it('collects every error on a row', () => {
    const r = plan({ nama: '', kategori: '', harga: 'x', favorit: 'm', aktif: 'm' });
    expect(r?.errors.map((e) => e.column)).toEqual([
      'nama',
      'kategori',
      'harga',
      'favorit',
      'aktif',
    ]);
  });
});

describe('matching', () => {
  it('creates new products with defaults and sort_order handled by the caller', () => {
    const { rows, summary } = buildPlan([row(2, { nama: 'Baru', kategori: 'Makanan' })], [], CATS);
    expect(rows[0]).toMatchObject({
      action: 'create',
      is_favorite: false,
      is_active: true,
      categoryId: 'c2',
      category_is_new: false,
    });
    expect(summary).toEqual({ total: 1, create: 1, update: 0, unchanged: 0, error: 0 });
  });

  it('creates a new category once for all rows that mention it', () => {
    const { rows, newCategories } = buildPlan(
      [
        row(2, { nama: 'A', kategori: 'Snack' }),
        row(3, { nama: 'B', kategori: ' snack ' }),
        row(4, { nama: 'C', kategori: 'Minuman' }),
      ],
      [],
      CATS,
    );
    expect(newCategories).toEqual(['Snack', 'Minuman']);
    expect(rows.map((r) => r.category_is_new)).toEqual([true, true, true]);
  });

  it('matches names case-insensitively and reports changes', () => {
    const { rows } = buildPlan(
      [row(2, { nama: 'jus   jeruk', kategori: 'Makanan', harga: 'Rp 16.000', favorit: 'ya' })],
      [product()],
      CATS,
    );
    expect(rows[0]).toMatchObject({ action: 'update', product_id: 'p1', is_active: true });
    expect(rows[0]?.changes).toEqual([
      { field: 'price', before: 15000, after: 16000 },
      { field: 'category', before: 'Jus Buah', after: 'Makanan' },
      { field: 'is_favorite', before: false, after: true },
    ]);
  });

  it('keeps old values for empty optional cells and reports unchanged', () => {
    const { rows, summary } = buildPlan(
      [
        row(2, {
          nama: 'Jus Jeruk',
          kategori: 'jus buah',
          harga: '15000',
          favorit: '',
          aktif: null,
        }),
      ],
      [product({ isFavorite: true, isActive: false })],
      CATS,
    );
    expect(rows[0]).toMatchObject({ action: 'unchanged', is_favorite: true, is_active: false });
    expect(summary.unchanged).toBe(1);
  });

  it('flags duplicate names inside the file on every involved row', () => {
    const { rows, summary } = buildPlan(
      [
        row(2, { nama: 'Es Teh' }),
        row(5, { nama: 'es  teh' }),
        row(7, { nama: 'Kopi' }),
        row(9, { nama: 'ES TEH' }),
      ],
      [],
      CATS,
    );
    expect(rows.map((r) => r.action)).toEqual(['error', 'error', 'create', 'error']);
    expect(rows[0]?.errors[0]).toMatchObject({ code: 'DUPLICATE_IN_FILE' });
    expect(rows[0]?.errors[0]?.message).toContain('baris 5');
    expect(rows[1]?.errors[0]?.message).toContain('baris 2');
    expect(summary.error).toBe(3);
  });

  it('flags an ambiguous match when several existing products share the name', () => {
    const { rows } = buildPlan(
      [row(2, { nama: 'Jus Jeruk' })],
      [product({ id: 'p1' }), product({ id: 'p2', name: 'JUS JERUK' })],
      CATS,
    );
    expect(rows[0]?.errors.map((e) => e.code)).toEqual(['AMBIGUOUS_MATCH']);
    expect(rows[0]?.product_id).toBeNull();
  });

  it('uses the first category when several share a name', () => {
    const dup = [...CATS, { id: 'c3', name: 'jus buah' }];
    const { rows } = buildPlan([row(2, { nama: 'Z', kategori: 'Jus Buah' })], [], dup);
    expect(rows[0]?.categoryId).toBe('c1');
  });

  it('does not create categories for error rows', () => {
    const { newCategories, rows } = buildPlan(
      [row(2, { nama: 'A', kategori: 'Baru', harga: 'x' })],
      [],
      CATS,
    );
    expect(newCategories).toEqual([]);
    expect(rows[0]?.category_is_new).toBe(false);
  });
});
