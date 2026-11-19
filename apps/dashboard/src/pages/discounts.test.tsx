import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { json, mockApi, problem, renderApp, session } from '../test/helpers';

const RGN = '22222222-2222-4222-8222-222222222222';
const MANGGA = '44444444-4444-4444-8444-444444444444';
const DISC = '55555555-5555-4555-8555-555555555555';
const user = { id: 'u1', name: 'Albert' };
const outletRef = { id: RGN, code: 'JUS1', name: 'Jus Albert', timezone: 'Asia/Jakarta' };
const manager = {
  ...session,
  user: { ...session.user, outlets: [{ ...session.user.outlets[0], role: 'manager' as const }] },
};

const discount = (extra: Record<string, unknown> = {}) => ({
  id: DISC,
  version: 3,
  name: 'Promo Mangga',
  target_type: 'product',
  type: 'percent',
  value: 20,
  starts_on: '2026-11-01',
  ends_on: null,
  days_of_week: null,
  time_start: null,
  time_end: null,
  is_active: true,
  status: 'active',
  outlets: [
    {
      outlet: outletRef,
      products: [{ id: MANGGA, name: 'Jus Mangga', price: 12000, category_id: 'c1' }],
      categories: [],
    },
  ],
  created_by: user,
  created_at: '2026-11-01T00:00:00Z',
  updated_by: user,
  updated_at: '2026-11-01T00:00:00Z',
  deleted: null,
  ...extra,
});

const options = {
  products: [
    {
      key: 'name:jus mangga',
      name: 'Jus Mangga',
      outlets: [
        {
          outlet: outletRef,
          product_id: MANGGA,
          price: 12000,
          category_id: 'c1',
          category_name: 'Jus',
        },
      ],
    },
  ],
  categories: [],
};

beforeEach(() => localStorage.clear());
afterEach(() => vi.unstubAllGlobals());

describe('Menu Diskon', () => {
  it('lists discounts with status and warns about devices that cannot apply them', async () => {
    mockApi({
      'POST /auth/refresh': () => json(session),
      'GET /discounts': () =>
        json({
          data: [discount(), discount({ id: 'd2', name: 'Promo Lama', status: 'ended', value: 5 })],
          outdated_devices: [
            {
              device_id: 'x',
              outlet: outletRef,
              code: 'K01',
              name: 'Kasir 1',
              app_version: null,
              last_seen_at: null,
            },
          ],
        }),
    });
    renderApp('/diskon');
    expect(await screen.findByText('Promo Mangga')).toBeInTheDocument();
    const list = within(screen.getByRole('list'));
    expect(list.getByText('Aktif')).toBeInTheDocument();
    expect(list.getByText('Selesai')).toBeInTheDocument();
    expect(screen.getByText(/Ada HP kasir yang belum mendukung diskon/)).toBeInTheDocument();
    expect(screen.getByText(/Kasir 1 \(K01\)/)).toBeInTheDocument();
  });

  it('creates a discount, previews the final price with the shared formula', async () => {
    const calls = mockApi({
      'POST /auth/refresh': () => json(session),
      'GET /discounts/target-options': () => json(options),
      'GET /discounts': () => json({ data: [], outdated_devices: [] }),
      'POST /discounts': () => json(discount(), 201),
    });
    renderApp('/diskon/baru');
    await userEvent.type(await screen.findByLabelText('Nama promo'), 'Promo Mangga');
    await userEvent.click(screen.getByRole('checkbox', { name: /Jus Mangga/ }));
    await userEvent.type(screen.getByLabelText('Potongan (%)'), '20');
    const preview = screen.getByLabelText('Pratinjau harga akhir');
    expect(within(preview).getByText(/Rp\s?9\.600/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Simpan' }));
    await waitFor(() =>
      expect(calls.find((c) => c.key === 'POST /discounts')?.body).toMatchObject({
        name: 'Promo Mangga',
        target_type: 'product',
        type: 'percent',
        value: 20,
        product_ids: [MANGGA],
        is_active: true,
      }),
    );
  });

  it('edits a discount of another branch than the active one without losing its targets', async () => {
    const PLM = '66666666-6666-4666-8666-666666666666';
    const PLM_PRODUCT = '77777777-7777-4777-8777-777777777777';
    const plm = { id: PLM, code: 'PLM', name: 'Palmerah', timezone: 'Asia/Jakarta' };
    const twoBranches = {
      ...session,
      user: {
        ...session.user,
        outlets: [
          session.user.outlets[0],
          { ...session.user.outlets[0], id: PLM, code: 'PLM', name: 'Palmerah' },
        ],
      },
    };
    const calls = mockApi({
      'POST /auth/refresh': () => json(twoBranches),
      [`GET /discounts/${DISC}`]: () =>
        json({
          ...discount({
            outlets: [
              {
                outlet: plm,
                products: [
                  { id: PLM_PRODUCT, name: 'Jus Mangga', price: 13000, category_id: 'c9' },
                ],
                categories: [],
              },
            ],
          }),
          history: [],
        }),
      'GET /discounts/target-options': () =>
        json({
          products: [
            {
              key: 'name:jus mangga',
              name: 'Jus Mangga',
              outlets: [
                {
                  outlet: outletRef,
                  product_id: MANGGA,
                  price: 12000,
                  category_id: 'c1',
                  category_name: 'Jus',
                },
                {
                  outlet: plm,
                  product_id: PLM_PRODUCT,
                  price: 13000,
                  category_id: 'c9',
                  category_name: 'Jus',
                },
              ],
            },
          ],
          categories: [],
        }),
      [`PATCH /discounts/${DISC}`]: () => json(discount()),
      'GET /discounts': () => json({ data: [], outdated_devices: [] }),
    });
    renderApp(`/diskon/${DISC}`);
    const box = await screen.findByRole('checkbox', { name: /Jus Mangga/ });
    expect(box).toBeChecked();
    await userEvent.click(screen.getByRole('button', { name: 'Simpan' }));
    await waitFor(() =>
      expect(calls.find((c) => c.key === `PATCH /discounts/${DISC}`)?.body).toMatchObject({
        version: 3,
        product_ids: [PLM_PRODUCT],
      }),
    );
    expect(calls.some((c) => c.key.includes('outlet_scope=all'))).toBe(true);
  });

  it('validates the form before calling the API', async () => {
    const calls = mockApi({
      'POST /auth/refresh': () => json(session),
      'GET /discounts/target-options': () => json(options),
    });
    renderApp('/diskon/baru');
    await userEvent.click(await screen.findByRole('button', { name: 'Simpan' }));
    expect(await screen.findByText('Nama promo wajib diisi.')).toBeInTheDocument();
    expect(screen.getByText('Pilih minimal satu produk atau kategori.')).toBeInTheDocument();
    expect(calls.some((c) => c.key === 'POST /discounts')).toBe(false);
  });

  it('deactivates a discount with its version, then explains a version conflict', async () => {
    const calls = mockApi({
      'POST /auth/refresh': () => json(session),
      'GET /discounts': () => json({ data: [discount()], outdated_devices: [] }),
      [`GET /discounts/${DISC}`]: () =>
        json({
          ...discount(),
          history: [
            {
              id: 'h1',
              version: 1,
              action: 'create',
              changes: null,
              reason: null,
              actor: user,
              created_at: '2026-11-01T00:00:00Z',
            },
          ],
        }),
      [`PATCH /discounts/${DISC}`]: () => problem(409, 'DISCOUNT_VERSION_CONFLICT'),
    });
    renderApp('/diskon');
    await userEvent.click(await screen.findByText('Promo Mangga'));
    const dialog = await screen.findByRole('dialog');
    expect(await within(dialog).findByText(/Dibuat/)).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Nonaktifkan' }));
    await waitFor(() =>
      expect(calls.find((c) => c.key === `PATCH /discounts/${DISC}`)?.body).toEqual({
        version: 3,
        is_active: false,
      }),
    );
    expect(await within(dialog).findByText(/sudah diubah orang lain/)).toBeInTheDocument();
  });

  it('asks a reason before deleting', async () => {
    const calls = mockApi({
      'POST /auth/refresh': () => json(session),
      'GET /discounts': () => json({ data: [discount()], outdated_devices: [] }),
      [`GET /discounts/${DISC}`]: () => json({ ...discount(), history: [] }),
      [`DELETE /discounts/${DISC}`]: () => json(discount({ status: 'deleted' })),
    });
    renderApp('/diskon');
    await userEvent.click(await screen.findByText('Promo Mangga'));
    await userEvent.click(await screen.findByRole('button', { name: 'Hapus' }));
    const dialog = await screen.findByRole('dialog');
    const confirm = within(dialog).getByRole('button', { name: 'Ya, hapus' });
    expect(confirm).toBeDisabled();
    await userEvent.type(within(dialog).getByLabelText('Alasan (wajib)'), 'Salah input');
    await userEvent.click(confirm);
    await waitFor(() =>
      expect(calls.find((c) => c.key === `DELETE /discounts/${DISC}`)?.body).toEqual({
        reason: 'Salah input',
      }),
    );
  });

  it('is view-only for a manager', async () => {
    mockApi({
      'POST /auth/refresh': () => json(manager),
      'GET /discounts': () => json({ data: [discount()], outdated_devices: [] }),
      [`GET /discounts/${DISC}`]: () => json({ ...discount(), history: [] }),
    });
    renderApp('/diskon');
    expect(screen.queryByRole('link', { name: /Buat diskon/ })).not.toBeInTheDocument();
    await userEvent.click(await screen.findByText('Promo Mangga'));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/Tampilan lihat saja/)).toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: 'Nonaktifkan' })).not.toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: 'Hapus' })).not.toBeInTheDocument();
  });

  it('shows the discount badge and struck-through price on the product page', async () => {
    mockApi({
      'POST /auth/refresh': () => json(session),
      'GET /discounts': () => json({ data: [discount()], outdated_devices: [] }),
      'GET /categories': () => json({ data: [{ id: 'c1', name: 'Jus' }] }),
      'GET /products': () =>
        json({
          data: [
            {
              id: MANGGA,
              name: 'Jus Mangga',
              price: 12000,
              category_id: 'c1',
              is_active: true,
              is_sold_out: false,
              image_url: null,
            },
          ],
        }),
    });
    renderApp('/produk');
    expect(await screen.findByText(/Diskon 20% · Promo Mangga/)).toBeInTheDocument();
    expect(screen.getByText(/Rp\s?9\.600/)).toBeInTheDocument();
  });
});
