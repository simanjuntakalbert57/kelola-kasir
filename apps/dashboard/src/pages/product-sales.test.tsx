import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { json, mockApi, problem, renderApp, session } from '../test/helpers';

const RGN = '22222222-2222-4222-8222-222222222222';
const PLM = '33333333-3333-4333-8333-333333333333';
const MANGGA = '44444444-4444-4444-8444-444444444444';
const outlet = (id: string, code: string, name: string, role: 'owner' | 'manager' = 'owner') => ({
  id,
  code,
  name,
  timezone: 'Asia/Jakarta',
  role,
  operations_started_on: null,
});
const owner = {
  ...session,
  active_outlet_id: RGN,
  user: {
    ...session.user,
    outlets: [outlet(RGN, 'RGN', 'Ragunan'), outlet(PLM, 'PLM', 'Palmerah')],
  },
};
const manager = {
  ...session,
  active_outlet_id: RGN,
  user: { ...session.user, outlets: [outlet(RGN, 'RGN', 'Ragunan', 'manager')] },
};

const summary = {
  revenue: 1325000,
  transaction_count: 66,
  average_ticket: 20075,
  cash_revenue: 820000,
  qris_revenue: 505000,
  cash_count: 41,
  qris_count: 25,
  voided_count: 0,
  pending_void_count: 0,
  items_sold: 312,
  outlet_scope: 'current',
  by_outlet: [],
};

const row = (i: number, extra: Record<string, unknown> = {}) => ({
  key: `k${i}`,
  product_id: i === 1 ? MANGGA : `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
  product_name: i === 1 ? 'Jus Mangga' : `Produk ${i}`,
  category_name: 'Jus',
  items_sold: 100 - i,
  revenue: (100 - i) * 10000,
  share_pct: 10,
  transaction_count: 5,
  has_sales: true,
  ...extra,
});
const rows = [
  ...Array.from({ length: 10 }, (_, n) => row(n + 1)),
  row(11, { product_name: 'Jus Nol', items_sold: 0, revenue: 0, share_pct: 0, has_sales: false }),
];
const report = (data: unknown[], extra: Record<string, unknown> = {}) => ({
  outlet_scope: 'current',
  date_from: '2026-10-26',
  date_to: '2026-10-26',
  totals: { items_sold: 900, revenue: 9000000, product_count: 11 },
  data,
  ...extra,
});

const detail = (extra: Record<string, unknown> = {}) => ({
  product_id: MANGGA,
  product_name: 'Jus Mangga',
  category_name: 'Jus',
  catalog_price: 20000,
  outlet_scope: 'current',
  date_from: '2026-10-26',
  date_to: '2026-10-26',
  items_sold: 99,
  revenue: 990000,
  average_price: 10000,
  share_pct: 11,
  transaction_count: 40,
  rank: 1,
  product_count: 11,
  compare_previous_period: { items_sold_change_pct: 12.4, revenue_change_pct: null },
  by_payment_method: [
    { method: 'cash', items_sold: 60, revenue: 600000, share_pct: 60.6 },
    { method: 'qris', items_sold: 39, revenue: 390000, share_pct: 39.4 },
  ],
  by_outlet: [{ outlet_id: RGN, outlet_name: 'Ragunan', items_sold: 99, revenue: 990000 }],
  by_employee: [
    {
      employee_id: RGN,
      employee_name: 'Sari',
      outlet_name: 'Ragunan',
      items_sold: 99,
      revenue: 990000,
    },
  ],
  ...extra,
});

function setup(
  opts: { sess?: unknown; products?: (key: string) => Response; detail?: () => Response } = {},
) {
  return mockApi({
    'POST /auth/refresh': () => json(opts.sess ?? owner),
    'GET /dashboard/summary': () => json(summary),
    'GET /dashboard/sales-series': () => json({ data: [] }),
    'GET /shifts': () => json({ data: [], next_cursor: null }),
    'GET /reports/products': (_b, key) => (opts.products ? opts.products(key) : json(report(rows))),
    [`GET /reports/products/${MANGGA}`]: () => (opts.detail ? opts.detail() : json(detail())),
    [`GET /reports/products/${MANGGA}/series`]: () =>
      json({ data: [{ bucket_start: '2026-10-26T03:00:00Z', items_sold: 5, revenue: 50000 }] }),
  });
}
const card = async () =>
  within(await screen.findByRole('region', { name: 'Penjualan per Produk' }));

beforeEach(() => localStorage.clear());
afterEach(() => vi.unstubAllGlobals());

describe('Kartu Penjualan per Produk', () => {
  it('shows the header count and the top 8 sold rows, expanding in place to every product', async () => {
    setup();
    renderApp('/');
    const c = await card();
    expect(await c.findByText(/Mengikuti filter di atas · 11 produk/)).toBeInTheDocument();
    expect(c.getAllByRole('listitem')).toHaveLength(8);
    expect(c.queryByText('Jus Nol')).not.toBeInTheDocument();
    await userEvent.click(c.getByRole('button', { name: 'Lihat semua 11 produk' }));
    expect(c.getAllByRole('listitem')).toHaveLength(11);
    expect(c.getByText('Belum terjual')).toBeInTheDocument();
    await userEvent.click(c.getByRole('button', { name: 'Tampilkan 8 teratas' }));
    expect(c.getAllByRole('listitem')).toHaveLength(8);
  });

  it('sorts through the column headers and sends outlet_scope current / all', async () => {
    const calls = setup();
    renderApp('/');
    const c = await card();
    await c.findByText('Jus Mangga');
    expect(
      calls.some(
        (x) =>
          x.key.includes('/reports/products?') &&
          x.key.includes('outlet_scope=current') &&
          x.key.includes('sort=items_sold'),
      ),
    ).toBe(true);
    await userEvent.click(c.getByRole('button', { name: /^Total/ }));
    await waitFor(() =>
      expect(calls.some((x) => x.key.includes('sort=revenue&order=desc'))).toBe(true),
    );
    expect(c.getByRole('columnheader', { name: /Total/ })).toHaveAttribute(
      'aria-sort',
      'descending',
    );
    await userEvent.click(
      within(c.getByRole('columnheader', { name: /Produk/ })).getByRole('button'),
    );
    await waitFor(() =>
      expect(calls.some((x) => x.key.includes('sort=name&order=asc'))).toBe(true),
    );

    await userEvent.click(screen.getByRole('button', { name: /Ganti cabang/ }));
    await userEvent.click(screen.getByRole('option', { name: /Semua cabang/ }));
    await waitFor(() =>
      expect(
        calls.some(
          (x) => x.key.includes('/reports/products?') && x.key.includes('outlet_scope=all'),
        ),
      ).toBe(true),
    );
  });

  it('searches with q (debounced) and shows products without sales in the results', async () => {
    const calls = setup({
      products: (key) => json(key.includes('q=nol') ? report([rows[10]]) : report(rows)),
    });
    renderApp('/');
    const c = await card();
    await c.findByText('Jus Mangga');
    await userEvent.type(c.getByRole('searchbox', { name: 'Cari produk' }), 'nol');
    expect(await c.findByText('Jus Nol')).toBeInTheDocument();
    expect(calls.some((x) => x.key.includes('q=nol'))).toBe(true);
    expect(c.queryByRole('button', { name: /Lihat semua/ })).not.toBeInTheDocument();
  });

  it('says nothing was found for a search without matches', async () => {
    setup({ products: (key) => json(key.includes('q=zzz') ? report([]) : report(rows)) });
    renderApp('/');
    const c = await card();
    await c.findByText('Jus Mangga');
    await userEvent.type(c.getByRole('searchbox', { name: 'Cari produk' }), 'zzz');
    expect(await c.findByText(/Produk “zzz” tidak ditemukan/)).toBeInTheDocument();
  });

  it('shows the empty state with a filter reset when nothing sold', async () => {
    setup({
      products: () =>
        json(report([rows[10]], { totals: { items_sold: 0, revenue: 0, product_count: 1 } })),
    });
    renderApp('/');
    const c = await card();
    expect(await c.findByText('Belum ada penjualan di periode ini')).toBeInTheDocument();
    expect(c.getByRole('button', { name: 'Atur ulang filter' })).toBeInTheDocument();
  });

  it('shows a retryable error only inside the card', async () => {
    let fail = true;
    setup({ products: () => (fail ? problem(500, 'INTERNAL') : json(report(rows))) });
    renderApp('/');
    const c = await card();
    expect(await c.findByText('Data penjualan produk belum bisa dimuat')).toBeInTheDocument();
    expect(screen.getByText(/^Rp\s?1\.325\.000$/)).toBeInTheDocument();
    fail = false;
    await userEvent.click(c.getByRole('button', { name: 'Coba lagi' }));
    expect(await c.findByText('Jus Mangga')).toBeInTheDocument();
  });

  it('does not open rows without product_id', async () => {
    setup({
      products: () => json(report([row(2, { product_id: null, product_name: 'Jus Lama' })])),
    });
    renderApp('/');
    const c = await card();
    await c.findByText('Jus Lama');
    expect(c.queryByRole('button', { name: /Jus Lama/ })).not.toBeInTheDocument();
  });

  it('exports xlsx with the same filters and no q', async () => {
    const calls = setup();
    const blob = new Response('x', {
      headers: { 'Content-Disposition': 'attachment; filename="penjualan-produk.xlsx"' },
    });
    const base = globalThis.fetch as unknown as (
      i: string,
      init?: RequestInit,
    ) => Promise<Response>;
    vi.stubGlobal('fetch', async (i: string, init?: RequestInit) =>
      String(i).includes('/reports/products/export')
        ? (calls.push({ key: `GET ${String(i).replace(/^.*\/v1/, '')}`, body: undefined }), blob)
        : base(i, init),
    );
    URL.createObjectURL = vi.fn(() => 'blob:x');
    URL.revokeObjectURL = vi.fn();
    renderApp('/');
    const c = await card();
    await c.findByText('Jus Mangga');
    await userEvent.type(c.getByRole('searchbox', { name: 'Cari produk' }), 'man');
    await userEvent.click(c.getByRole('button', { name: /Ekspor Excel/ }));
    await waitFor(() =>
      expect(calls.some((x) => x.key.includes('/reports/products/export'))).toBe(true),
    );
    const exp = calls.find((x) => x.key.includes('/reports/products/export'))?.key ?? '';
    expect(exp).toContain('format=xlsx');
    expect(exp).toContain('outlet_scope=current');
    expect(exp).toContain('sort=items_sold');
    expect(exp).not.toContain('q=');
  });
});

describe('Detail produk', () => {
  it('opens from a row, updates the URL param, shows detail and closes with Esc', async () => {
    setup();
    renderApp('/');
    const c = await card();
    const trigger = await c.findByRole('button', { name: /Jus Mangga/ });
    await userEvent.click(trigger);
    const dlg = await screen.findByRole('dialog', { name: 'Detail Jus Mangga' });
    expect((await within(dlg).findAllByText('99 cup')).length).toBeGreaterThan(0);
    expect(within(dlg).getByText('Peringkat 1 dari 11')).toBeInTheDocument();
    expect(within(dlg).getByText(/Harga katalog/)).toBeInTheDocument();
    expect(within(dlg).getByText(/Naik 12,4%/)).toBeInTheDocument();
    expect(within(dlg).getByText(/Tunai 60 cup/)).toBeInTheDocument();
    expect(within(dlg).getByText('Per kasir')).toBeInTheDocument();
    expect(within(dlg).queryByText('Per cabang')).not.toBeInTheDocument();
    expect(within(dlg).queryByText(/Jam paling laris/)).not.toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(trigger).toHaveFocus();
  });

  it('opens straight from /?produk=<id> and closes with the Tutup button', async () => {
    setup();
    renderApp(`/?produk=${MANGGA}`);
    const dlg = await screen.findByRole('dialog', { name: /Detail/ });
    await within(dlg).findAllByText('99 cup');
    await userEvent.click(within(dlg).getByRole('button', { name: 'Tutup' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('shows Per cabang only with "Semua cabang"', async () => {
    const calls = setup({ detail: () => json(detail({ outlet_scope: 'all' })) });
    renderApp('/');
    await screen.findByText('Jus Mangga');
    await userEvent.click(screen.getByRole('button', { name: /Ganti cabang/ }));
    await userEvent.click(screen.getByRole('option', { name: /Semua cabang/ }));
    await userEvent.click(await screen.findByRole('button', { name: /Jus Mangga/ }));
    const dlg = await screen.findByRole('dialog');
    expect(await within(dlg).findByText('Per cabang')).toBeInTheDocument();
    expect(
      calls.some(
        (x) =>
          x.key.startsWith(`GET /reports/products/${MANGGA}?`) &&
          x.key.includes('outlet_scope=all'),
      ),
    ).toBe(true);
  });

  it('toasts and drops the param on 404', async () => {
    setup({ detail: () => problem(404, 'NOT_FOUND') });
    renderApp(`/?produk=${MANGGA}`);
    expect(await screen.findByText('Produk tidak ditemukan')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });
});

describe('Manajer', () => {
  it('never sends outlet_scope=all and has no Per cabang', async () => {
    const calls = setup({ sess: manager });
    renderApp('/');
    const c = await card();
    await c.findByText('Jus Mangga');
    expect(
      calls
        .filter((x) => x.key.includes('/reports/'))
        .every((x) => !x.key.includes('outlet_scope=all')),
    ).toBe(true);
    expect(screen.queryByText('Per cabang')).not.toBeInTheDocument();
  });
});
