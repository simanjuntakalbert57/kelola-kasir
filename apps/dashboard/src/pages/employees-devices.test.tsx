import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { json, mockApi, problem, renderApp, session } from '../test/helpers';

afterEach(() => vi.unstubAllGlobals());

const sari = { id: 'e1', name: 'Sari', is_active: true };
const dewi = { id: 'e2', name: 'Dewi', is_active: false };

describe('Pegawai', () => {
  it('lists employees with status', async () => {
    mockApi({
      'POST /auth/refresh': () => json(session),
      'GET /employees': () => json({ data: [sari, dewi] }),
    });
    renderApp('/pegawai');
    expect(await screen.findByText('Sari')).toBeInTheDocument();
    expect(screen.getByText('Nonaktif')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Aktifkan Dewi' })).toBeInTheDocument();
  });

  it('adds an employee and rejects a non 6-digit PIN client-side', async () => {
    const calls = mockApi({
      'POST /auth/refresh': () => json(session),
      'GET /employees': () => json({ data: [] }),
      'POST /employees': () => json({ id: 'e3', name: 'Budi', is_active: true }, 201),
    });
    renderApp('/pegawai');
    await userEvent.click(await screen.findByRole('button', { name: /Tambah pegawai/ }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText('Nama'), 'Budi');
    await userEvent.type(within(dialog).getByLabelText('PIN (6 digit)'), '123');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Simpan' }));
    expect(await within(dialog).findByText('PIN harus 6 digit angka.')).toBeInTheDocument();
    expect(calls.some((c) => c.key === 'POST /employees')).toBe(false);

    await userEvent.type(within(dialog).getByLabelText('PIN (6 digit)'), '456');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Simpan' }));
    await vi.waitFor(() =>
      expect(calls.find((c) => c.key === 'POST /employees')?.body).toEqual({
        name: 'Budi',
        pin: '123456',
      }),
    );
  });

  it('shows a friendly message when the PIN is already used', async () => {
    mockApi({
      'POST /auth/refresh': () => json(session),
      'GET /employees': () => json({ data: [sari] }),
      'POST /employees/e1/reset-pin': () => problem(409, 'PIN_NOT_UNIQUE'),
    });
    renderApp('/pegawai');
    await userEvent.click(await screen.findByRole('button', { name: 'Atur ulang PIN Sari' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText('PIN baru (6 digit)'), '111111');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Simpan PIN' }));
    expect(await within(dialog).findByText(/PIN sudah dipakai pegawai lain/)).toBeInTheDocument();
  });

  it('deactivates an employee', async () => {
    const calls = mockApi({
      'POST /auth/refresh': () => json(session),
      'GET /employees': () => json({ data: [sari] }),
      'PATCH /employees/e1': () => json({ ...sari, is_active: false }),
    });
    renderApp('/pegawai');
    await userEvent.click(await screen.findByRole('button', { name: 'Nonaktifkan Sari' }));
    await vi.waitFor(() =>
      expect(calls.find((c) => c.key === 'PATCH /employees/e1')?.body).toEqual({
        is_active: false,
      }),
    );
  });
});

describe('Perangkat', () => {
  const tablet = {
    id: 'd1',
    code: 'K01',
    name: 'Tablet Depan',
    status: 'active',
    last_seen_at: null,
  };

  it('creates a device and shows the one-time pairing code', async () => {
    mockApi({
      'POST /auth/refresh': () => json(session),
      'GET /devices': () => json({ data: [] }),
      'POST /devices': () =>
        json(
          {
            device: { ...tablet, status: 'pending_pairing' },
            pairing_code: 'ABCD2345',
            pairing_expires_at: '2026-10-26T08:10:00Z',
          },
          201,
        ),
    });
    renderApp('/perangkat');
    await userEvent.click(await screen.findByRole('button', { name: /Tambah perangkat/ }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText('Nama perangkat'), 'Tablet Depan');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Buat kode pairing' }));
    expect(await within(dialog).findByText('ABCD2345')).toBeInTheDocument();
  });

  it('revokes a device after confirmation', async () => {
    const calls = mockApi({
      'POST /auth/refresh': () => json(session),
      'GET /devices': () => json({ data: [tablet] }),
      'POST /devices/d1/revoke': () => json({ ...tablet, status: 'revoked' }),
    });
    renderApp('/perangkat');
    await userEvent.click(await screen.findByRole('button', { name: 'Cabut Tablet Depan' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cabut perangkat' }));
    await vi.waitFor(() =>
      expect(calls.some((c) => c.key === 'POST /devices/d1/revoke')).toBe(true),
    );
  });
});
