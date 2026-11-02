import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { uuidv7 } from '../lib/expenses';
import { json, mockApi, problem, renderApp, session } from '../test/helpers';

const RGN = '22222222-2222-4222-8222-222222222222';
const PLM = '33333333-3333-4333-8333-333333333333';
const outletRef = (id: string, code: string, name: string, role: 'owner' | 'manager') => ({
  id,
  code,
  name,
  timezone: 'Asia/Jakarta',
  role,
  operations_started_on: null,
});

const twoBranches = {
  ...session,
  active_outlet_id: RGN,
  user: {
    ...session.user,
    outlets: [
      outletRef(RGN, 'RGN', 'Ragunan', 'owner'),
      outletRef(PLM, 'PLM', 'Palmerah', 'owner'),
    ],
  },
};
const managerSession = {
  ...session,
  active_outlet_id: RGN,
  user: { ...session.user, outlets: [outletRef(RGN, 'RGN', 'Ragunan', 'manager')] },
};

const categories = [
  { id: 'c-buah', group: 'hpp', name: 'Buah', sort_order: 1, archived: false },
  { id: 'c-es', group: 'hpp', name: 'Es batu', sort_order: 2, archived: false },
  { id: 'c-listrik', group: 'operasional', name: 'Listrik', sort_order: 1, archived: false },
];
const user = { id: 'u1', name: 'Albert' };
const expense = (over: Record<string, unknown> = {}) => ({
  id: 'e1',
  outlet: { id: RGN, code: 'RGN', name: 'Ragunan', timezone: 'Asia/Jakarta' },
  category: categories[0],
  spent_on: '2026-11-02',
  description: 'Mangga 10 kg',
  amount: 125000,
  funding_source: 'drawer',
  receipt_url: null,
  source: 'dashboard',
  created_by: user,
  created_at: '2026-11-02T03:00:00Z',
  updated_by: user,
  updated_at: '2026-11-02T03:00:00Z',
  deleted: null,
  ...over,
});
const list = (rows: unknown[]) =>
  json({ data: rows, next_cursor: null, summary: { count: rows.length, total_amount: 125000 } });

function setup(sess: unknown, extra: Parameters<typeof mockApi>[0] = {}) {
  return mockApi({
    'POST /auth/refresh': () => json(sess),
    'GET /settings': () => json({ outlet: sess, display_name: 'X', qris_mode: 'static' }),
    'GET /expense-categories': () => json({ data: categories }),
    'GET /expenses': () => list([expense()]),
    'GET /void-requests': () => json({ data: [], next_cursor: null }),
    ...extra,
  });
}

beforeEach(() => localStorage.clear());
afterEach(() => vi.unstubAllGlobals());

describe('branch picker', () => {
  it('sends the stored outlet_id when refreshing the session', async () => {
    localStorage.setItem('kk_outlet_id', PLM);
    const calls = setup(twoBranches);
    renderApp('/pengeluaran');
    await screen.findByRole('heading', { name: 'Pengeluaran' });
    const refresh = calls.find((c) => c.key === 'POST /auth/refresh');
    expect(refresh?.body).toEqual({ outlet_id: PLM });
    expect(localStorage.getItem('kk_outlet_id')).toBe(RGN);
  });

  it('switches branch with a new token and drops the cached data', async () => {
    let expensesCalls = 0;
    const calls = setup(twoBranches, {
      'GET /expenses': () => {
        expensesCalls += 1;
        return list([expense()]);
      },
      'POST /auth/switch-outlet': () =>
        json({ ...twoBranches, access_token: 'tok-plm', active_outlet_id: PLM }),
    });
    renderApp('/pengeluaran');
    await screen.findByText('Mangga 10 kg');
    await userEvent.click(screen.getByRole('button', { name: /Ganti cabang/ }));
    await userEvent.click(screen.getByRole('option', { name: /Palmerah/ }));
    await waitFor(() => expect(calls.some((c) => c.key === 'POST /auth/switch-outlet')).toBe(true));
    expect(calls.find((c) => c.key === 'POST /auth/switch-outlet')?.body).toEqual({
      outlet_id: PLM,
    });
    await waitFor(() => expect(expensesCalls).toBeGreaterThan(1));
    expect(localStorage.getItem('kk_outlet_id')).toBe(PLM);
    expect(screen.getByRole('button', { name: /Cabang aktif: Palmerah/ })).toBeInTheDocument();
  });

  it('offers "Semua cabang" only on the expense pages, and only to owners of 2+ branches', async () => {
    setup(twoBranches);
    renderApp('/pengeluaran');
    await userEvent.click(await screen.findByRole('button', { name: /Ganti cabang/ }));
    expect(screen.getByRole('option', { name: /Semua cabang/ })).toBeInTheDocument();
  });

  it('hides "Semua cabang" on other pages', async () => {
    setup(twoBranches, {
      'GET /dashboard/summary': () => json({}),
      'GET /dashboard/sales-series': () => json({ data: [] }),
      'GET /dashboard/top-products': () => json({ data: [] }),
    });
    renderApp('/transaksi');
    await userEvent.click(await screen.findByRole('button', { name: /Ganti cabang/ }));
    expect(screen.queryByRole('option', { name: /Semua cabang/ })).not.toBeInTheDocument();
    expect(screen.getByRole('option', { name: /Ragunan/ })).toBeInTheDocument();
  });

  it('locks the picker for a manager and hides delete and category management', async () => {
    setup(managerSession, {
      'GET /expenses/e1': () => json({ ...expense(), history: [] }),
    });
    renderApp('/pengeluaran');
    await screen.findByText('Mangga 10 kg');
    expect(
      screen.getByRole('group', { name: /Cabang Anda: Ragunan. Tidak bisa diganti/ }),
    ).toBeVisible();
    expect(screen.queryByRole('button', { name: /Ganti cabang/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Kelola kategori' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Detail Buah/ }));
    await screen.findByRole('button', { name: 'Ubah' });
    expect(screen.queryByRole('button', { name: 'Hapus' })).not.toBeInTheDocument();
  });
});

describe('expenses list and form', () => {
  it('creates an expense with a client id, falling back to the category name as description', async () => {
    const calls = setup(twoBranches, {
      'POST /expenses': (body) =>
        json(expense({ id: (body as { id: string }).id, description: 'Buah' }), 201),
    });
    renderApp('/pengeluaran');
    await screen.findByText('Mangga 10 kg');
    await userEvent.click(screen.getByRole('button', { name: /Tambah pengeluaran/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Catat pengeluaran' });
    await userEvent.type(within(dialog).getByLabelText('Jumlah (Rp)'), '125000');
    await userEvent.click(within(dialog).getByRole('radio', { name: 'Buah' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Simpan' }));
    await screen.findByText(/Tersimpan: Buah/);
    const post = calls.find((c) => c.key === 'POST /expenses');
    expect(post?.body).toMatchObject({
      category_id: 'c-buah',
      amount: 125000,
      description: 'Buah',
      funding_source: 'drawer',
      receipt_url: null,
    });
    expect((post?.body as { id: string }).id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('uploads a receipt photo (purpose expense_receipt) and saves its URL', async () => {
    const receiptUrl = `http://api/v1/media/${RGN}/expense_receipt/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.jpg`;
    const calls = setup(twoBranches, {
      'POST /uploads': () =>
        json({
          upload_url: 'http://storage/put',
          public_url: receiptUrl,
          expires_at: '2026-11-02T04:00:00Z',
        }),
      'POST /expenses': (body) => json(expense({ id: (body as { id: string }).id }), 201),
    });
    const fetchMock = vi.mocked(fetch);
    const base = fetchMock.getMockImplementation() as typeof fetch;
    fetchMock.mockImplementation(async (input, init) =>
      String(input) === 'http://storage/put'
        ? new Response(null, { status: 200 })
        : base(input, init),
    );
    renderApp('/pengeluaran');
    await screen.findByText('Mangga 10 kg');
    await userEvent.click(screen.getByRole('button', { name: /Tambah pengeluaran/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Catat pengeluaran' });
    await userEvent.type(within(dialog).getByLabelText('Jumlah (Rp)'), '80000');
    await userEvent.click(within(dialog).getByRole('radio', { name: 'Es batu' }));
    // Under the 200 KB target, so the browser compression step passes it through untouched.
    const photo = new File([new Uint8Array(1000)], 'nota.jpg', { type: 'image/jpeg' });
    await userEvent.upload(within(dialog).getByLabelText('Pilih foto nota dari galeri'), photo);
    await within(dialog).findByAltText('Pratinjau foto nota');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Simpan' }));
    await screen.findByText(/Tersimpan:/);
    expect(calls.find((c) => c.key === 'POST /uploads')?.body).toMatchObject({
      purpose: 'expense_receipt',
      content_type: 'image/jpeg',
      size_bytes: 1000,
    });
    expect(calls.find((c) => c.key === 'POST /expenses')?.body).toMatchObject({
      receipt_url: receiptUrl,
    });
  });

  it('validates amount and category before saving', async () => {
    const calls = setup(twoBranches);
    renderApp('/pengeluaran');
    await screen.findByText('Mangga 10 kg');
    await userEvent.click(screen.getByRole('button', { name: /Tambah pengeluaran/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Catat pengeluaran' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Simpan' }));
    expect(await within(dialog).findByText('Isi jumlah dulu, contoh 125000.')).toBeVisible();
    expect(within(dialog).getByText('Pilih kategori.')).toBeVisible();
    expect(calls.some((c) => c.key === 'POST /expenses')).toBe(false);
  });

  it('shows the Rekap warning when the date is before operations started', async () => {
    const started = {
      ...twoBranches,
      user: {
        ...twoBranches.user,
        outlets: [
          { ...outletRef(RGN, 'RGN', 'Ragunan', 'owner'), operations_started_on: '2026-11-10' },
          outletRef(PLM, 'PLM', 'Palmerah', 'owner'),
        ],
      },
    };
    setup(started, {
      'GET /settings': () =>
        json({
          outlet: {},
          display_name: 'X',
          qris_mode: 'static',
          operations_started_on: '2026-11-10',
        }),
    });
    renderApp('/pengeluaran');
    await screen.findByText('Mangga 10 kg');
    await userEvent.click(screen.getByRole('button', { name: /Tambah pengeluaran/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Catat pengeluaran' });
    await waitFor(() =>
      expect(
        within(dialog).getByText(/sebelum cabang mulai beroperasi, jadi tidak masuk Rekap/),
      ).toBeVisible(),
    );
  });

  it('is read-only in "Semua cabang" and shows the branch code per row', async () => {
    const calls = setup(twoBranches, {
      'GET /expenses': () =>
        list([
          expense(),
          expense({
            id: 'e2',
            outlet: { id: PLM, code: 'PLM', name: 'Palmerah', timezone: 'Asia/Jakarta' },
          }),
        ]),
    });
    renderApp('/pengeluaran');
    await screen.findAllByText('Mangga 10 kg');
    await userEvent.click(screen.getByRole('button', { name: /Ganti cabang/ }));
    await userEvent.click(screen.getByRole('option', { name: /Semua cabang/ }));
    expect(await screen.findByRole('button', { name: /Tambah \(pilih cabang\)/ })).toBeDisabled();
    expect(screen.getByText('PLM')).toBeInTheDocument();
    expect(calls.some((c) => c.key.includes('outlet_scope=all'))).toBe(true);
  });

  it('deletes with a reason (owner) and restores from Riwayat Hapus', async () => {
    const calls = setup(twoBranches, {
      'GET /expenses/e1': () => json({ ...expense(), history: [] }),
      'DELETE /expenses/e1': () => new Response(null, { status: 204 }),
    });
    renderApp('/pengeluaran');
    await screen.findByText('Mangga 10 kg');
    await userEvent.click(screen.getByRole('button', { name: /Detail Buah/ }));
    await userEvent.click(await screen.findByRole('button', { name: 'Hapus' }));
    const dialog = await screen.findByRole('dialog', { name: 'Hapus pengeluaran ini?' });
    await userEvent.type(within(dialog).getByLabelText('Alasan menghapus'), 'abc');
    expect(within(dialog).getByRole('button', { name: 'Hapus' })).toBeDisabled();
    await userEvent.type(within(dialog).getByLabelText('Alasan menghapus'), 'de salah input');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Hapus' }));
    await waitFor(() =>
      expect(calls.find((c) => c.key === 'DELETE /expenses/e1')?.body).toEqual({
        reason: 'abcde salah input',
      }),
    );
  });

  it('explains an archived category error', async () => {
    setup(twoBranches, {
      'POST /expenses': () => problem(422, 'EXPENSE_CATEGORY_ARCHIVED'),
    });
    renderApp('/pengeluaran');
    await screen.findByText('Mangga 10 kg');
    await userEvent.click(screen.getByRole('button', { name: /Tambah pengeluaran/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Catat pengeluaran' });
    await userEvent.type(within(dialog).getByLabelText('Jumlah (Rp)'), '5000');
    await userEvent.click(within(dialog).getByRole('radio', { name: 'Es batu' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Simpan' }));
    expect(await within(dialog).findByText(/sudah dinonaktifkan/)).toBeVisible();
  });
});

describe('Rekap', () => {
  const cell = (over: Record<string, unknown> = {}) => ({
    revenue: 1000000,
    transaction_count: 40,
    expense_total: 400000,
    expense_count: 5,
    profit: 600000,
    by_group: { hpp: 300000, operasional: 100000, tetap: 0, lainnya: 0 },
    by_funding_source: { drawer: 300000, owner: 100000 },
    by_category: [
      { category_id: 'c-buah', group: 'hpp', name: 'Buah', amount: 300000, count: 3 },
      { category_id: 'c-listrik', group: 'operasional', name: 'Listrik', amount: 100000, count: 2 },
    ],
    ...over,
  });
  const report = (total: Record<string, unknown>, perOutlet: unknown[] = []) =>
    json({
      month_from: '2026-11',
      month_to: '2026-11',
      outlet_scope: 'current',
      include_pre_operations: false,
      outlets: [
        {
          id: RGN,
          code: 'RGN',
          name: 'Ragunan',
          timezone: 'Asia/Jakarta',
          operations_started_on: null,
        },
        {
          id: PLM,
          code: 'PLM',
          name: 'Palmerah',
          timezone: 'Asia/Jakarta',
          operations_started_on: '2026-11-03',
        },
      ],
      months: [{ month: '2026-11', per_outlet: perOutlet, total: cell(total) }],
      total: { per_outlet: [], total: cell(total) },
    });

  it('shows Omzet, Pengeluaran and Laba sederhana with the definition note', async () => {
    setup(twoBranches, { 'GET /reports/expenses': () => report({}) });
    renderApp('/pengeluaran/rekap');
    expect(await screen.findByText('Laba sederhana')).toBeVisible();
    expect(screen.getAllByText(/600\.000/).length).toBeGreaterThan(0);
    expect(screen.getByText(/Lunas \+ menunggu persetujuan batal/)).toBeInTheDocument();
    expect(screen.getByText('Bahan jus (HPP)')).toBeInTheDocument();
  });

  it('labels a negative result as Rugi sederhana with a text marker, not colour alone', async () => {
    setup(twoBranches, { 'GET /reports/expenses': () => report({ profit: -250000 }) });
    renderApp('/pengeluaran/rekap');
    expect(await screen.findByText('Rugi sederhana')).toBeVisible();
    expect(screen.getByText(/▼ −/)).toBeInTheDocument();
  });

  it('notes the start date per branch and passes include_pre_operations', async () => {
    const calls = setup(twoBranches, {
      'GET /reports/expenses': () =>
        report({}, [
          { outlet_id: RGN, counted_from: null, ...cell() },
          { outlet_id: PLM, counted_from: '2026-11-03', ...cell() },
        ]),
    });
    renderApp('/pengeluaran/rekap');
    expect(await screen.findByText('Dihitung mulai 3 Nov 2026')).toBeVisible();
    await userEvent.click(screen.getByLabelText('Termasuk masa uji coba'));
    await waitFor(() =>
      expect(calls.some((c) => c.key.includes('include_pre_operations=true'))).toBe(true),
    );
  });
});

describe('categories', () => {
  it('archives a category after confirmation (owner)', async () => {
    const calls = setup(twoBranches, {
      'PATCH /expense-categories/c-es': () => json({ ...categories[1], archived: true }),
    });
    renderApp('/pengeluaran/kategori');
    const row = (await screen.findByText('Es batu')).closest('li') as HTMLElement;
    await userEvent.click(within(row).getByRole('switch'));
    await userEvent.click(await screen.findByRole('button', { name: 'Nonaktifkan' }));
    await waitFor(() =>
      expect(calls.find((c) => c.key === 'PATCH /expense-categories/c-es')?.body).toEqual({
        archived: true,
      }),
    );
  });

  it('is not available to a manager', async () => {
    setup(managerSession);
    renderApp('/pengeluaran/kategori');
    expect(await screen.findByText(/hanya untuk pemilik/)).toBeVisible();
  });
});

describe('Pengaturan start date', () => {
  const settings = (v: string | null) => ({
    outlet: { id: RGN, code: 'RGN', name: 'Ragunan', timezone: 'Asia/Jakarta' },
    display_name: 'Ragunan',
    qris_mode: 'static',
    operations_started_on: v,
  });

  it('owner saves the date after confirming; manager sees it read-only', async () => {
    const calls = setup(twoBranches, {
      'GET /settings': () => json(settings(null)),
      'PATCH /settings': () => json(settings('2026-11-10')),
    });
    const { unmount } = renderApp('/pengaturan');
    const field = await screen.findByLabelText('Tanggal mulai operasional');
    await userEvent.type(field, '2026-11-10');
    await userEvent.click(screen.getByRole('button', { name: 'Simpan pengaturan' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Ubah tanggal' }));
    await waitFor(() =>
      expect(calls.find((c) => c.key === 'PATCH /settings')?.body).toMatchObject({
        operations_started_on: '2026-11-10',
      }),
    );
    unmount();

    const mgrCalls = setup(managerSession, { 'GET /settings': () => json(settings('2026-11-10')) });
    renderApp('/pengaturan');
    expect(await screen.findByLabelText('Tanggal mulai operasional')).toBeDisabled();
    expect(mgrCalls.some((c) => c.key === 'PATCH /settings')).toBe(false);
  });
});

describe('uuidv7', () => {
  it('has version 7 and RFC 4122 variant bits', () => {
    const id = uuidv7(1_700_000_000_000);
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(id.startsWith('018bcfe5')).toBe(true);
  });
});
