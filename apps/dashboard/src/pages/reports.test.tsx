import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { json, mockApi, problem, renderApp, session } from '../test/helpers';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function pickOption(combo: HTMLElement, name: string) {
  await userEvent.click(combo);
  await userEvent.click(await screen.findByRole('option', { name }));
}

const employee = { id: 'e1', name: 'Sari', is_active: true };
const summary = {
  revenue: 1250000,
  transaction_count: 74,
  average_ticket: 16891,
  cash_revenue: 775000,
  qris_revenue: 475000,
  cash_count: 40,
  qris_count: 34,
  voided_count: 1,
  pending_void_count: 1,
  compare_previous_period: { revenue_change_pct: 12.4 },
};
const tx = (over: Record<string, unknown> = {}) => ({
  id: 't1',
  number: 'JUS1-K01-261026-0042',
  status: 'paid',
  payment_method: 'cash',
  total: 52000,
  employee,
  client_created_at: '2026-10-26T07:32:00Z',
  paid_at: '2026-10-26T07:32:00Z',
  ...over,
});
const voidReq = {
  id: 'vr9',
  transaction_id: 't1',
  transaction_number: 'JUS1-K01-261026-0040',
  transaction_total: 27000,
  reason: 'Salah pesan menu',
  status: 'pending',
  requested_by: employee,
  requested_at: '2026-10-26T07:07:00Z',
};

describe('Dashboard', () => {
  it('shows greeting, hero revenue, top products and the shift info / pending cancel cards', async () => {
    mockApi({
      'POST /auth/refresh': () => json(session),
      'GET /dashboard/summary': () => json(summary),
      'GET /dashboard/sales-series': () =>
        json({
          data: [
            { bucket_start: '2026-10-26T03:00:00Z', revenue: 100000, transaction_count: 5 },
            { bucket_start: '2026-10-26T06:00:00Z', revenue: 300000, transaction_count: 12 },
          ],
        }),
      'GET /dashboard/top-products': () =>
        json({
          data: [{ product_id: 'p1', product_name: 'Jus Alpukat', quantity: 21, revenue: 420000 }],
        }),
      'GET /shifts': () =>
        json({ data: [{ id: 's1', opened_by: employee, status: 'open' }], next_cursor: null }),
    });
    renderApp('/');
    expect(await screen.findByText(/^Rp\s?1\.250\.000$/)).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: /^Selamat (pagi|siang|sore|malam), Pak Albert/ }),
    ).toBeInTheDocument();
    expect(screen.getByText('Pesanan', { exact: true })).toBeInTheDocument();
    expect(screen.queryByText(/gelas terjual/i)).not.toBeInTheDocument();
    expect(screen.getByText(/74 pesanan hari ini\./)).toBeInTheDocument();
    expect(screen.getByText(/Tunai 62%/)).toBeInTheDocument();
    expect(screen.getByText(/QRIS 38%/)).toBeInTheDocument();
    expect(screen.getByText(/▲ 12% dari kemarin/)).toBeInTheDocument();
    expect(await screen.findByText(/1\. Jus Alpukat/)).toBeInTheDocument();
    expect(screen.getByRole('img', { name: /Penjualan per jam, puncak 13/ })).toBeInTheDocument();
    expect(await screen.findByText(/Sari lagi jaga kasir/)).toBeInTheDocument();
    expect(screen.getByText('1 permintaan batal nunggu Bapak')).toBeInTheDocument();
  });

  it('says the day is rame when revenue is ≥15% above the previous seven days over the same hours', async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-10-26T03:00:00Z') });
    const calls = mockApi({
      'POST /auth/refresh': () => json(session),
      'GET /dashboard/summary': () => json(summary),
      'GET /dashboard/sales-series': () => json({ data: [] }),
      'GET /dashboard/top-products': () => json({ data: [] }),
      'GET /shifts': () => json({ data: [], next_cursor: null }),
    });
    const base = globalThis.fetch as unknown as (
      i: string,
      init?: RequestInit,
    ) => Promise<Response>;
    vi.stubGlobal('fetch', async (i: string, init?: RequestInit) => {
      if (String(i).includes('date_from=2026-10-19')) {
        // 08.00 WIB on each of the previous seven days; "now" is 10.00 WIB.
        return json({
          data: Array.from({ length: 7 }, (_, n) => ({
            bucket_start: `2026-10-${19 + n}T01:00:00Z`,
            revenue: 500000,
            transaction_count: 20,
          })),
        });
      }
      return base(i, init);
    });
    renderApp('/');
    expect(await screen.findByText(/Hari ini rame, Pak!/)).toBeInTheDocument();
    expect(calls.length).toBeGreaterThan(0);
  });

  it('hides the rame/sepi sentence without a week of history and for other ranges', async () => {
    mockApi({
      'POST /auth/refresh': () => json(session),
      'GET /dashboard/summary': () => json(summary),
      'GET /dashboard/sales-series': () => json({ data: [] }),
      'GET /dashboard/top-products': () => json({ data: [] }),
      'GET /shifts': () => json({ data: [], next_cursor: null }),
    });
    renderApp('/');
    expect(await screen.findByText(/74 pesanan hari ini\./)).toBeInTheDocument();
    expect(screen.queryByText(/Hari ini (rame|lagi sepi|normal)/)).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '7 hari' }));
    expect(await screen.findByText(/▲ 12% dari periode lalu/)).toBeInTheDocument();
    expect(screen.queryByText(/dari kemarin/)).not.toBeInTheDocument();
  });

  it('shows the empty state and a retryable error state', async () => {
    let fail = true;
    mockApi({
      'POST /auth/refresh': () => json(session),
      'GET /dashboard/summary': () =>
        fail ? problem(500, 'INTERNAL') : json({ ...summary, transaction_count: 0, revenue: 0 }),
      'GET /dashboard/sales-series': () => json({ data: [] }),
      'GET /dashboard/top-products': () => json({ data: [] }),
      'GET /shifts': () => json({ data: [], next_cursor: null }),
    });
    renderApp('/');
    expect(await screen.findByText('Waduh, ringkasannya belum kebuka.')).toBeInTheDocument();
    fail = false;
    await userEvent.click(screen.getByRole('button', { name: 'Coba lagi' }));
    expect((await screen.findAllByText('Belum ada yang beli.')).length).toBeGreaterThan(0);
  });

  it('switches to a daily chart for a multi-day range', async () => {
    const calls = mockApi({
      'POST /auth/refresh': () => json(session),
      'GET /dashboard/summary': () => json(summary),
      'GET /dashboard/sales-series': () => json({ data: [] }),
      'GET /dashboard/top-products': () => json({ data: [] }),
      'GET /shifts': () => json({ data: [], next_cursor: null }),
    });
    renderApp('/');
    await userEvent.click(await screen.findByRole('button', { name: '7 hari' }));
    await vi.waitFor(() => expect(calls.some((c) => c.key.includes('granularity=day'))).toBe(true));
  });
});

describe('Transaksi', () => {
  it('shows the date on rows only when the range spans more than one day', async () => {
    mockApi({
      'POST /auth/refresh': () => json(session),
      'GET /employees': () => json({ data: [employee] }),
      'GET /transactions': () => json({ data: [tx({ item_count: 3 })], next_cursor: null }),
    });
    renderApp('/transaksi');
    const row = await screen.findByRole('button', { name: /Detail JUS1/ });
    expect(row).toHaveTextContent(/Sari · 14\.32/);
    expect(row).toHaveTextContent('3 item · Tunai');
    expect(screen.getByText('1 transaksi hari ini')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '7 hari' }));
    expect(await screen.findByText('1 transaksi di rentang ini')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Detail JUS1/ })).toHaveTextContent(
      /Sari · 26 Okt 14\.32/,
    );
  });

  it('lists, filters by method and opens the detail', async () => {
    const calls = mockApi({
      'POST /auth/refresh': () => json(session),
      'GET /employees': () => json({ data: [employee] }),
      'GET /transactions': () => json({ data: [tx()], next_cursor: null }),
      'GET /transactions/t1': () =>
        json({
          ...tx(),
          subtotal: 52000,
          discount_amount: 0,
          tax_amount: 0,
          items: [
            {
              id: 'i1',
              product_name: 'Jus Alpukat',
              unit_price: 26000,
              quantity: 2,
              line_total: 52000,
            },
          ],
          payments: [{ id: 'pay1', cash_tendered: 60000, cash_change: 8000 }],
        }),
    });
    renderApp('/transaksi');
    expect(await screen.findByRole('button', { name: /Detail JUS1/ })).toBeInTheDocument();
    expect(screen.getAllByText('Lunas').length).toBeGreaterThan(0);

    await pickOption(screen.getByLabelText('Metode'), 'QRIS');
    await vi.waitFor(() =>
      expect(
        calls.some(
          (c) => c.key.includes('GET /transactions?') && c.key.includes('payment_method=qris'),
        ),
      ).toBe(true),
    );

    await userEvent.click(screen.getByRole('button', { name: /Detail JUS1/ }));
    const panel = await screen.findByRole('complementary', { name: 'Detail transaksi' });
    expect(await within(panel).findByText(/2× Jus Alpukat/)).toBeInTheDocument();
    expect(within(panel).getByText(/kembalian Rp\s?8\.000/)).toBeInTheDocument();
    expect(within(panel).getByText(/Transaksi JUS1-K01-261026-0042/)).toBeInTheDocument();
  });

  it('hides filters behind a Filter sheet on a phone', async () => {
    vi.stubGlobal('matchMedia', () => ({
      matches: false,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }));
    const calls = mockApi({
      'POST /auth/refresh': () => json(session),
      'GET /employees': () => json({ data: [employee] }),
      'GET /transactions': () => json({ data: [tx()], next_cursor: null }),
    });
    renderApp('/transaksi');
    expect(await screen.findByRole('button', { name: /Detail JUS1/ })).toBeInTheDocument();
    expect(screen.queryByLabelText('Metode')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /^Filter/ }));
    const sheet = await screen.findByRole('dialog');
    await pickOption(within(sheet).getByLabelText('Metode'), 'QRIS');
    await userEvent.click(within(sheet).getByRole('button', { name: 'Terapkan' }));
    await vi.waitFor(() =>
      expect(calls.some((c) => c.key.includes('payment_method=qris'))).toBe(true),
    );
    expect(screen.getByRole('button', { name: 'Filter (1)' })).toBeInTheDocument();
    // Detail opens as a sheet, not a side panel.
    await userEvent.click(screen.getByRole('button', { name: /Detail JUS1/ }));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
  });

  it('shows the empty state with a reset action', async () => {
    mockApi({
      'POST /auth/refresh': () => json(session),
      'GET /employees': () => json({ data: [employee] }),
      'GET /transactions': () => json({ data: [], next_cursor: null }),
    });
    renderApp('/transaksi');
    await pickOption(await screen.findByLabelText('Status'), 'Dibatalkan');
    expect(await screen.findByText('Belum ada transaksi di rentang ini.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reset filter' })).toBeInTheDocument();
  });

  it('filters by shift when opened from a shift link', async () => {
    const shiftId = '11111111-1111-4111-8111-111111111111';
    const calls = mockApi({
      'POST /auth/refresh': () => json(session),
      'GET /employees': () => json({ data: [employee] }),
      'GET /transactions': () => json({ data: [tx()], next_cursor: null }),
    });
    renderApp(`/transaksi?shift_id=${shiftId}&date_from=2026-10-25&date_to=2026-10-26`);
    expect(await screen.findByText('Menampilkan 1 transaksi')).toBeInTheDocument();
    expect(
      calls.some(
        (c) =>
          c.key.includes('GET /transactions?') &&
          c.key.includes(`shift_id=${shiftId}`) &&
          c.key.includes('date_from=2026-10-25') &&
          c.key.includes('date_to=2026-10-26'),
      ),
    ).toBe(true);
    expect(screen.queryByRole('button', { name: 'Ekspor CSV' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Hapus filter shift' }));
    await vi.waitFor(() =>
      expect(
        calls.some((c) => c.key.includes('GET /transactions?') && !c.key.includes('shift_id')),
      ).toBe(true),
    );
  });

  it('downloads an export through the authenticated client', async () => {
    const create = vi.fn(() => 'blob:x');
    vi.stubGlobal('URL', { createObjectURL: create, revokeObjectURL: vi.fn() });
    const calls = mockApi({
      'POST /auth/refresh': () => json(session),
      'GET /employees': () => json({ data: [] }),
      'GET /transactions': () => json({ data: [], next_cursor: null }),
    });
    const base = globalThis.fetch as unknown as (
      i: string,
      init?: RequestInit,
    ) => Promise<Response>;
    vi.stubGlobal('fetch', async (i: string, init?: RequestInit) => {
      if (String(i).includes('/transactions/export')) {
        calls.push({ key: `GET ${String(i).replace(/^.*\/v1/, '')}`, body: undefined });
        return new Response('a,b', {
          headers: { 'Content-Disposition': 'attachment; filename="trx.csv"' },
        });
      }
      return base(i, init);
    });
    renderApp('/transaksi');
    await userEvent.click(await screen.findByRole('button', { name: 'Ekspor CSV' }));
    await vi.waitFor(() => expect(create).toHaveBeenCalled());
    expect(
      calls.some((c) => c.key.includes('/transactions/export') && c.key.includes('format=csv')),
    ).toBe(true);
  });
});

describe('Shift & kas', () => {
  const shift = (id: string, diff: number | null, over: Record<string, unknown> = {}) => ({
    id,
    opened_by: employee,
    status: 'closed',
    opening_cash: 200000,
    expected_cash: 840000,
    actual_cash: diff === null ? null : 840000 + diff,
    cash_difference: diff,
    opened_at: '2026-10-26T01:00:00Z',
    ...over,
  });

  it('marks differences with text and sign, and filters to differences only', async () => {
    mockApi({
      'POST /auth/refresh': () => json(session),
      'GET /employees': () => json({ data: [employee] }),
      'GET /shifts': () =>
        json({ data: [shift('s1', -5000), shift('s2', 0), shift('s3', 5000)], next_cursor: null }),
    });
    renderApp('/shift');
    expect(await screen.findByText(/▼ Kurang Rp\s?5\.000/)).toBeInTheDocument();
    expect(screen.getByText('Pas')).toBeInTheDocument();
    expect(screen.getByText(/▲ Lebih Rp\s?5\.000/)).toBeInTheDocument();

    await userEvent.click(screen.getByLabelText('Hanya yang selisih'));
    expect(screen.queryByText('Pas')).not.toBeInTheDocument();
    expect(screen.getByText(/▼ Kurang Rp\s?5\.000/)).toBeInTheDocument();
  });

  it('"Hanya yang selisih" loads every page so older differences are not hidden', async () => {
    let shiftCalls = 0;
    mockApi({
      'POST /auth/refresh': () => json(session),
      'GET /employees': () => json({ data: [employee] }),
      'GET /shifts?status=open&limit=5': () => json({ data: [], next_cursor: null }),
      'GET /shifts': () =>
        shiftCalls++ > 0
          ? json({ data: [shift('old', -5000)], next_cursor: null })
          : json({ data: [shift('new', 0)], next_cursor: 'c2' }),
    });
    renderApp('/shift');
    expect(await screen.findByText('Pas')).toBeInTheDocument();
    await userEvent.click(screen.getByLabelText('Hanya yang selisih'));
    expect(await screen.findByText(/▼ Kurang Rp\s?5\.000/)).toBeInTheDocument();
    expect(screen.queryByText('Pas')).not.toBeInTheDocument();
  });

  it('shows the running shift as an info card', async () => {
    mockApi({
      'POST /auth/refresh': () => json(session),
      'GET /employees': () => json({ data: [employee] }),
      'GET /shifts': () =>
        json({
          data: [shift('s1', null, { status: 'open', opened_at: '2026-10-26T00:30:00Z' })],
          next_cursor: null,
        }),
    });
    renderApp('/shift');
    expect(
      await screen.findByText(/Sari lagi jaga sejak 07\.30 · Kas awal Rp\s?200\.000/),
    ).toBeInTheDocument();
  });

  it('opens the shift summary with per-cashier breakdown', async () => {
    mockApi({
      'POST /auth/refresh': () => json(session),
      'GET /employees': () => json({ data: [employee] }),
      'GET /shifts': () =>
        json({ data: [shift('s1', -5000, { closed_offline: true })], next_cursor: null }),
      'GET /shifts/s1/summary': () =>
        json({
          shift: shift('s1', -5000),
          total_cash_sales: 640000,
          total_qris_sales: 310000,
          total_sales: 950000,
          transaction_count: 30,
          expected_cash: 840000,
          actual_cash: 835000,
          cash_difference: -5000,
          pending_void_count: 0,
          pending_void_amount: 0,
          voided_count: 1,
          voided_amount: 12000,
          by_employee: [
            { employee, transaction_count: 30, total_cash_sales: 640000, total_qris_sales: 310000 },
          ],
        }),
    });
    renderApp('/shift');
    await userEvent.click(await screen.findByRole('button', { name: /Detail shift/ }));
    const dialog = await screen.findByRole('dialog');
    expect(await within(dialog).findByText(/^Rp\s?640\.000$/)).toBeInTheDocument();
    expect(within(dialog).getByText(/ditutup saat offline/)).toBeInTheDocument();
    expect(within(dialog).getByText(/Sari · 30 transaksi/)).toBeInTheDocument();
  });

  it('links a shift that crosses midnight to the full opened-to-closed date range', async () => {
    const id = '22222222-2222-4222-8222-222222222222';
    const night = shift(id, 0, {
      opened_at: '2026-10-25T13:00:00Z', // 25 Oct 20:00 WIB
      closed_at: '2026-10-25T19:00:00Z', // 26 Oct 02:00 WIB
    });
    const calls = mockApi({
      'POST /auth/refresh': () => json(session),
      'GET /employees': () => json({ data: [employee] }),
      'GET /shifts': () => json({ data: [night], next_cursor: null }),
      [`GET /shifts/${id}/summary`]: () =>
        json({
          shift: night,
          total_cash_sales: 0,
          total_qris_sales: 0,
          total_sales: 0,
          transaction_count: 0,
          expected_cash: 840000,
          actual_cash: 840000,
          cash_difference: 0,
          pending_void_count: 0,
          pending_void_amount: 0,
          voided_count: 0,
          voided_amount: 0,
          by_employee: [],
        }),
      'GET /transactions': () => json({ data: [tx()], next_cursor: null }),
    });
    renderApp('/shift');
    await userEvent.click(await screen.findByRole('button', { name: /Detail shift/ }));
    await userEvent.click(await screen.findByRole('link', { name: 'Lihat daftar transaksi' }));
    await vi.waitFor(() =>
      expect(
        calls.some(
          (c) =>
            c.key.includes('GET /transactions?') &&
            c.key.includes(`shift_id=${id}`) &&
            c.key.includes('date_from=2026-10-25') &&
            c.key.includes('date_to=2026-10-26'),
        ),
      ).toBe(true),
    );
  });
});

describe('Void', () => {
  it('approves a pending void request with a note', async () => {
    const calls = mockApi({
      'POST /auth/refresh': () => json(session),
      'GET /void-requests': () => json({ data: [voidReq], next_cursor: null }),
      'POST /void-requests/vr9/approve': () => json({ ...voidReq, status: 'approved' }),
      'GET /dashboard/summary': () => json(summary),
    });
    renderApp('/void');
    expect(await screen.findByText(/Salah pesan menu/)).toBeInTheDocument();
    await userEvent.click(
      screen.getByRole('button', { name: /Setujui batal JUS1-K01-261026-0040/ }),
    );
    const dialog = await screen.findByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText('Catatan (opsional)'), 'Sesuai laporan');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Ya, setujui batal' }));
    await vi.waitFor(() =>
      expect(calls.find((c) => c.key === 'POST /void-requests/vr9/approve')?.body).toEqual({
        note: 'Sesuai laporan',
      }),
    );
  });

  it('shows the friendly empty state when nothing is pending', async () => {
    mockApi({
      'POST /auth/refresh': () => json(session),
      'GET /void-requests': () => json({ data: [], next_cursor: null }),
    });
    renderApp('/void');
    expect(await screen.findByText('Semua beres, Pak.')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Persetujuan batal' })).toBeInTheDocument();
  });

  it('rejects a request and explains a conflict', async () => {
    mockApi({
      'POST /auth/refresh': () => json(session),
      'GET /void-requests': () => json({ data: [voidReq], next_cursor: null }),
      'POST /void-requests/vr9/reject': () => problem(409, 'TRANSACTION_NOT_VOIDABLE'),
    });
    renderApp('/void');
    await userEvent.click(await screen.findByRole('button', { name: /Tolak batal/ }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Ya, tolak' }));
    expect(await within(dialog).findByText(/sudah diproses/)).toBeInTheDocument();
  });

  it('loads further pages of pending void requests', async () => {
    const mk = (id: string, n: string) => ({ ...voidReq, id, transaction_number: n });
    mockApi({
      'POST /auth/refresh': () => json(session),
      'GET /void-requests?status=pending&cursor=c2': () =>
        json({ data: [mk('vr52', 'TRX-52')], next_cursor: null }),
      'GET /void-requests?status=pending': () =>
        json({ data: [mk('vr1', 'TRX-01')], next_cursor: 'c2' }),
    });
    renderApp('/void');
    expect(await screen.findByText(/Menampilkan 1 permintaan/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Muat lebih banyak' }));
    expect(await screen.findByRole('button', { name: /Setujui batal TRX-52/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Muat lebih banyak' })).not.toBeInTheDocument();
  });
});
