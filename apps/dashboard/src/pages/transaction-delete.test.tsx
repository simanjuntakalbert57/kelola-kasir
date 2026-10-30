import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { json, mockApi, problem, renderApp, session } from '../test/helpers';

afterEach(() => vi.unstubAllGlobals());

const employee = { id: 'e1', name: 'Sari', is_active: true };
const base = {
  id: 't1',
  number: 'JUS1-K01-261026-0042',
  status: 'paid',
  payment_method: 'cash',
  total: 52000,
  employee,
  client_created_at: '2026-10-26T07:32:00Z',
  paid_at: '2026-10-26T07:32:00Z',
};
const detail = (over: Record<string, unknown> = {}) => ({
  ...base,
  items: [],
  payments: [],
  deleted: null,
  ...over,
});
const owner = { type: 'user', id: 'u1', name: 'Albert', role: 'owner', outlet_id: 'o1' };

function setup(
  me: Record<string, unknown>,
  tx: Record<string, unknown>,
  extra: Parameters<typeof mockApi>[0] = {},
) {
  return mockApi({
    'POST /auth/refresh': () => json(session),
    'GET /me': () => json(me),
    'GET /employees': () => json({ data: [employee] }),
    'GET /transactions': () => json({ data: [base], next_cursor: null }),
    'GET /transactions/t1': () => json(detail(tx)),
    ...extra,
  });
}

async function openDetail() {
  await userEvent.click(await screen.findByRole('button', { name: /Detail JUS1/ }));
}

describe('Hapus transaksi', () => {
  it('hides the delete button for a manager', async () => {
    setup({ ...owner, role: 'manager' }, {});
    renderApp('/transaksi');
    await openDetail();
    await screen.findByText('Total');
    expect(screen.queryByRole('button', { name: 'Hapus transaksi' })).not.toBeInTheDocument();
    expect(screen.queryByText('Riwayat Hapus')).not.toBeInTheDocument();
  });

  it.each(['pending', 'void_requested'])(
    'disables the button with a hint for %s',
    async (status) => {
      setup(owner, { status });
      renderApp('/transaksi');
      await openDetail();
      const btn = await screen.findByRole('button', { name: 'Hapus transaksi' });
      expect(btn).toBeDisabled();
      expect(screen.getByText('Selesaikan pembayaran/void dulu')).toBeInTheDocument();
    },
  );

  it('requires a 5-200 character reason, then deletes and refetches', async () => {
    let deleted = false;
    const calls = setup(
      owner,
      {},
      {
        'DELETE /transactions/t1': () => {
          deleted = true;
          return json(detail());
        },
      },
    );
    renderApp('/transaksi');
    await openDetail();
    await userEvent.click(await screen.findByRole('button', { name: 'Hapus transaksi' }));
    const dialog = await screen.findByRole('dialog', { name: 'Hapus transaksi ini?' });
    const confirm = within(dialog).getByRole('button', { name: 'Hapus transaksi' });
    expect(confirm).toBeDisabled();
    const box = within(dialog).getByLabelText('Alasan menghapus');
    await userEvent.type(box, '  ab  ');
    await userEvent.tab();
    expect(await within(dialog).findByText('Alasan minimal 5 karakter.')).toBeInTheDocument();
    expect(confirm).toBeDisabled();
    await userEvent.clear(box);
    await userEvent.type(box, 'input dobel');
    expect(confirm).toBeEnabled();
    const before = calls.filter((c) => c.key.startsWith('GET /transactions?')).length;
    await userEvent.click(confirm);
    await vi.waitFor(() => expect(deleted).toBe(true));
    expect(calls.find((c) => c.key === 'DELETE /transactions/t1')?.body).toEqual({
      reason: 'input dobel',
    });
    await vi.waitFor(() =>
      expect(calls.filter((c) => c.key.startsWith('GET /transactions?')).length).toBeGreaterThan(
        before,
      ),
    );
  });

  it('maps 409 TRANSACTION_NOT_DELETABLE to Indonesian copy', async () => {
    setup(
      owner,
      {},
      {
        'DELETE /transactions/t1': () => problem(409, 'TRANSACTION_NOT_DELETABLE'),
      },
    );
    renderApp('/transaksi');
    await openDetail();
    await userEvent.click(await screen.findByRole('button', { name: 'Hapus transaksi' }));
    const dialog = await screen.findByRole('dialog', { name: 'Hapus transaksi ini?' });
    await userEvent.type(within(dialog).getByLabelText('Alasan menghapus'), 'uji coba');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Hapus transaksi' }));
    expect(await within(dialog).findByText(/belum bisa dihapus/)).toBeInTheDocument();
  });
});

describe('Riwayat Hapus', () => {
  const deleted = {
    reason: 'transaksi uji coba',
    deleted_at: '2026-10-27T02:00:00Z',
    deleted_by: { id: 'u1', name: 'Albert' },
  };

  it('lists deleted transactions and restores one from the detail', async () => {
    let restored = false;
    const calls = setup(
      owner,
      {
        deleted,
        deletion_history: [
          {
            id: 'd1',
            action: 'delete',
            reason: deleted.reason,
            actor: deleted.deleted_by,
            created_at: deleted.deleted_at,
          },
        ],
      },
      {
        'GET /transactions/deleted': () =>
          json({ data: [{ ...base, deleted }], next_cursor: null }),
        'POST /transactions/t1/restore': () => {
          restored = true;
          return json(detail());
        },
      },
    );
    renderApp('/transaksi/dihapus');
    expect(await screen.findAllByText('transaksi uji coba')).not.toHaveLength(0);
    expect(calls.some((c) => c.key.includes('date_field=deleted_at'))).toBe(true);
    await userEvent.click(
      (await screen.findAllByRole('button', { name: /Detail JUS1/ }))[0] as HTMLElement,
    );
    expect(await screen.findByText(/Dihapus oleh Albert/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Pulihkan' }));
    const dialog = await screen.findByRole('dialog', { name: 'Pulihkan transaksi ini?' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Pulihkan' }));
    await vi.waitFor(() => expect(restored).toBe(true));
  });

  it('shows a lock message for a manager and does not call the API', async () => {
    const calls = setup({ ...owner, role: 'manager' }, {});
    renderApp('/transaksi/dihapus');
    expect(await screen.findByText('Riwayat Hapus hanya untuk pemilik.')).toBeInTheDocument();
    expect(calls.some((c) => c.key.startsWith('GET /transactions/deleted'))).toBe(false);
  });
});
