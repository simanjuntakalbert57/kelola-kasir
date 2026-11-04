import { screen, waitFor, within } from '@testing-library/react';
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

function setup(summary: (url: string) => unknown, sess: unknown = twoBranches) {
  const urls: string[] = [];
  const calls = mockApi({
    'POST /auth/refresh': () => json(sess),
    'GET /dashboard/summary': () => json(summary('')),
    'GET /dashboard/sales-series': () => json({ data: [] }),
    'GET /dashboard/top-products': () => json({ data: [] }),
    'GET /shifts': () => json({ data: [], next_cursor: null }),
  });
  return { calls, urls };
}

beforeEach(() => localStorage.clear());
afterEach(() => vi.unstubAllGlobals());

describe('Dashboard: cup terjual, Rp per metode, cabang', () => {
  it('shows the cup card with its comparison and Rp per payment method summing to revenue', async () => {
    setup(() => base);
    renderApp('/');
    const card = (await screen.findByText('Cup terjual')).closest('div') as HTMLElement;
    expect(within(card).getByText('312 cup')).toBeInTheDocument();
    expect(within(card).getByText(/▲ 12% dari kemarin/)).toBeInTheDocument();
    expect(screen.getByText(/Tunai Rp\s?820\.000 \(62%\) · 41 trx/)).toBeInTheDocument();
    expect(screen.getByText(/QRIS Rp\s?505\.000 \(38%\) · 25 trx/)).toBeInTheDocument();
    expect(base.cash_revenue + base.qris_revenue).toBe(base.revenue);
  });

  it('formats thousands in id-ID', async () => {
    setup(() => ({ ...base, items_sold: 1234 }));
    renderApp('/');
    expect(await screen.findByText('1.234 cup')).toBeInTheDocument();
  });

  it('sends outlet_scope=all and lists the per-branch breakdown for "Semua cabang"', async () => {
    const { calls } = setup(() => ({
      ...base,
      outlet_scope: 'current',
    }));
    renderApp('/');
    await screen.findByText('312 cup');
    expect(
      calls.some(
        (c) => c.key.includes('/dashboard/summary') && c.key.includes('outlet_scope=current'),
      ),
    ).toBe(true);
    expect(screen.queryByText('Per cabang')).not.toBeInTheDocument();

    mockApi({
      'POST /auth/refresh': () => json(twoBranches),
      'GET /dashboard/summary': () =>
        json({
          ...base,
          outlet_scope: 'all',
          by_outlet: [
            {
              outlet_id: RGN,
              outlet_code: 'RGN',
              outlet_name: 'Ragunan',
              revenue: 800000,
              cash_revenue: 500000,
              qris_revenue: 300000,
              items_sold: 190,
            },
            {
              outlet_id: PLM,
              outlet_code: 'PLM',
              outlet_name: 'Palmerah',
              revenue: 525000,
              cash_revenue: 320000,
              qris_revenue: 205000,
              items_sold: 122,
            },
          ],
        }),
      'GET /dashboard/sales-series': () => json({ data: [] }),
      'GET /dashboard/top-products': () => json({ data: [] }),
      'GET /shifts': () => json({ data: [], next_cursor: null }),
    });
    await userEvent.click(screen.getByRole('button', { name: /Ganti cabang/ }));
    await userEvent.click(screen.getByRole('option', { name: /Semua cabang/ }));
    const table = await screen.findByRole('table');
    expect(within(table).getByRole('row', { name: /Ragunan/ })).toHaveTextContent(/190/);
    expect(within(table).getByRole('row', { name: /Palmerah/ })).toHaveTextContent(/Rp\s?525\.000/);
    expect(screen.getByText('Per cabang')).toBeInTheDocument();
  });

  it('requests outlet_scope=all when "Semua cabang" is chosen', async () => {
    const calls = mockApi({
      'POST /auth/refresh': () => json(twoBranches),
      'GET /dashboard/summary': () => json(base),
      'GET /dashboard/sales-series': () => json({ data: [] }),
      'GET /dashboard/top-products': () => json({ data: [] }),
      'GET /shifts': () => json({ data: [], next_cursor: null }),
    });
    renderApp('/');
    await screen.findByText('312 cup');
    await userEvent.click(screen.getByRole('button', { name: /Ganti cabang/ }));
    await userEvent.click(screen.getByRole('option', { name: /Semua cabang/ }));
    await waitFor(() =>
      expect(
        calls.some(
          (c) => c.key.includes('/dashboard/summary') && c.key.includes('outlet_scope=all'),
        ),
      ).toBe(true),
    );
  });

  it('shows the empty state when revenue is 0', async () => {
    setup(() => ({
      ...base,
      revenue: 0,
      transaction_count: 0,
      cash_revenue: 0,
      qris_revenue: 0,
      cash_count: 0,
      qris_count: 0,
      items_sold: 0,
    }));
    renderApp('/');
    expect((await screen.findAllByText('Belum ada yang beli.')).length).toBeGreaterThan(0);
    expect(screen.queryByText('Cup terjual')).not.toBeInTheDocument();
  });
});
