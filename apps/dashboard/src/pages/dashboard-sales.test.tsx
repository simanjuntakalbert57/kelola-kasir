import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { json, mockApi, renderApp, session } from '../test/helpers';

const RGN = '22222222-2222-4222-8222-222222222222';
const PLM = '33333333-3333-4333-8333-333333333333';
const outlet = (id: string, code: string, name: string) => ({
  id,
  code,
  name,
  timezone: 'Asia/Jakarta',
  role: 'owner' as const,
  operations_started_on: null,
});
const twoBranches = {
  ...session,
  active_outlet_id: RGN,
  user: {
    ...session.user,
    outlets: [outlet(RGN, 'RGN', 'Ragunan'), outlet(PLM, 'PLM', 'Palmerah')],
  },
};

const base = {
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
  compare_previous_period: { revenue_change_pct: 5, items_sold_change_pct: 12.4 },
};

const byOutlet = [
  {
    outlet_id: RGN,
    outlet_name: 'Ragunan',
    revenue: 800000,
    cash_revenue: 500000,
    qris_revenue: 300000,
    items_sold: 190,
  },
  {
    outlet_id: PLM,
    outlet_name: 'Palmerah',
    revenue: 525000,
    cash_revenue: 320000,
    qris_revenue: 205000,
    items_sold: 122,
  },
];

/** One mock for every scenario: the summary answers according to the `outlet_scope` it is asked for. */
function setup(summary: Record<string, unknown> = base, sess: unknown = twoBranches) {
  return mockApi({
    'POST /auth/refresh': () => json(sess),
    'GET /dashboard/summary': (_body, key) =>
      json(
        key.includes('outlet_scope=all')
          ? { ...summary, outlet_scope: 'all', by_outlet: byOutlet }
          : { ...summary, outlet_scope: 'current' },
      ),
    'GET /dashboard/sales-series': () => json({ data: [] }),
    'GET /dashboard/top-products': () => json({ data: [] }),
    'GET /shifts': () => json({ data: [], next_cursor: null }),
  });
}

beforeEach(() => localStorage.clear());
afterEach(() => vi.unstubAllGlobals());

describe('Dashboard: cup terjual, Rp per metode, cabang', () => {
  it('shows the cup card with its comparison and Rp per payment method summing to revenue', async () => {
    setup();
    renderApp('/');
    const card = (await screen.findByText('Cup terjual')).closest('div') as HTMLElement;
    expect(within(card).getByText('312 cup')).toBeInTheDocument();
    expect(within(card).getByText(/▲ 12% dari kemarin/)).toBeInTheDocument();
    expect(screen.getByText(/Tunai Rp\s?820\.000 \(62%\) · 41 trx/)).toBeInTheDocument();
    expect(screen.getByText(/QRIS Rp\s?505\.000 \(38%\) · 25 trx/)).toBeInTheDocument();
    expect(base.cash_revenue + base.qris_revenue).toBe(base.revenue);
  });

  it('formats thousands in id-ID', async () => {
    setup({ ...base, items_sold: 1234 });
    renderApp('/');
    expect(await screen.findByText('1.234 cup')).toBeInTheDocument();
  });

  it('sends outlet_scope=all and lists the per-branch breakdown after choosing "Semua cabang"', async () => {
    const calls = setup();
    renderApp('/');
    await screen.findByText('312 cup');
    expect(calls.some((c) => c.key.includes('outlet_scope=current'))).toBe(true);
    expect(screen.queryByText('Per cabang')).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /Ganti cabang/ }));
    await userEvent.click(screen.getByRole('option', { name: /Semua cabang/ }));
    const table = await screen.findByRole('table');
    expect(
      calls.some((c) => c.key.includes('/dashboard/summary') && c.key.includes('outlet_scope=all')),
    ).toBe(true);
    expect(within(table).getByRole('row', { name: /Ragunan/ })).toHaveTextContent(/190/);
    expect(within(table).getByRole('row', { name: /Palmerah/ })).toHaveTextContent(/Rp\s?525\.000/);
  });

  it('on "Semua cabang" drops the rame/sepi sentence and labels chart and Terlaris with the active branch', async () => {
    const calls = setup();
    renderApp('/');
    await screen.findByText('312 cup');
    const before = calls.length;
    await userEvent.click(screen.getByRole('button', { name: /Ganti cabang/ }));
    await userEvent.click(screen.getByRole('option', { name: /Semua cabang/ }));
    await screen.findByRole('table');
    expect(
      screen.getByRole('heading', { name: /Penjualan per jam · Ragunan/ }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: /Terlaris hari ini · Ragunan/ }),
    ).toBeInTheDocument();
    expect(screen.queryByText(/rame|sepi/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Jam \d+ paling rame/)).not.toBeInTheDocument();
    // The 7-day history feeding rame/sepi spans several days; "today" series is a single day.
    const multiDay = calls.slice(before).filter((c) => {
      const q = new URLSearchParams(c.key.split('?')[1]);
      return c.key.includes('/dashboard/sales-series') && q.get('date_from') !== q.get('date_to');
    });
    expect(multiDay).toHaveLength(0);
  });

  it('shows the empty state when revenue is 0', async () => {
    setup({
      ...base,
      revenue: 0,
      transaction_count: 0,
      cash_revenue: 0,
      qris_revenue: 0,
      cash_count: 0,
      qris_count: 0,
      items_sold: 0,
    });
    renderApp('/');
    expect((await screen.findAllByText('Belum ada yang beli.')).length).toBeGreaterThan(0);
    expect(screen.queryByText('Cup terjual')).not.toBeInTheDocument();
  });
});
