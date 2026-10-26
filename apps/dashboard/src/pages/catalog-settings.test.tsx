import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { json, mockApi, problem, renderApp, session } from '../test/helpers';

afterEach(() => vi.unstubAllGlobals());

const cat = { id: 'c1', name: 'Jus Buah', sort_order: 0 };
const product = {
  id: 'p1',
  category_id: 'c1',
  name: 'Jus Alpukat',
  image_url: null,
  price: 15000,
  is_active: true,
  is_sold_out: false,
};
const base = {
  'POST /auth/refresh': () => json(session),
  'GET /categories': () => json({ data: [cat] }),
};

describe('Produk', () => {
  it('lists products with Rupiah prices and sold-out badge', async () => {
    mockApi({
      ...base,
      'GET /products': () => json({ data: [{ ...product, is_sold_out: true }] }),
    });
    renderApp('/produk');
    expect(await screen.findByText('Jus Alpukat')).toBeInTheDocument();
    expect(screen.getByText('Rp15.000')).toBeInTheDocument();
    expect(screen.getByText('Habis')).toBeInTheDocument();
  });

  it('creates a product sending the price as an integer', async () => {
    const calls = mockApi({
      ...base,
      'GET /products': () => json({ data: [] }),
      'POST /products': () => json(product, 201),
    });
    renderApp('/produk');
    await userEvent.click(await screen.findByRole('button', { name: /Tambah produk/ }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText('Nama produk'), 'Jus Alpukat');
    await userEvent.type(within(dialog).getByLabelText('Harga (Rp)'), '15.000');
    expect(within(dialog).getByText('Rp15.000')).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Simpan' }));
    await vi.waitFor(() =>
      expect(calls.find((c) => c.key === 'POST /products')?.body).toEqual({
        name: 'Jus Alpukat',
        category_id: 'c1',
        price: 15000,
        image_url: null,
        is_active: true,
      }),
    );
  });

  it('rejects decimal prices client-side', async () => {
    const calls = mockApi({ ...base, 'GET /products': () => json({ data: [] }) });
    renderApp('/produk');
    await userEvent.click(await screen.findByRole('button', { name: /Tambah produk/ }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText('Nama produk'), 'X');
    await userEvent.type(within(dialog).getByLabelText('Harga (Rp)'), '15000,50');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Simpan' }));
    expect(await within(dialog).findByText(/angka bulat Rupiah/)).toBeInTheDocument();
    expect(calls.some((c) => c.key === 'POST /products')).toBe(false);
  });

  it('marks a product sold out', async () => {
    const calls = mockApi({
      ...base,
      'GET /products': () => json({ data: [product] }),
      'PATCH /products/p1/availability': () => json({ ...product, is_sold_out: true }),
    });
    renderApp('/produk');
    await userEvent.click(await screen.findByRole('button', { name: 'Tandai habis Jus Alpukat' }));
    await vi.waitFor(() =>
      expect(calls.find((c) => c.key === 'PATCH /products/p1/availability')?.body).toEqual({
        is_sold_out: true,
      }),
    );
  });

  it('explains why a non-empty category cannot be deleted', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    mockApi({
      ...base,
      'GET /products': () => json({ data: [product] }),
      'DELETE /categories/c1': () => problem(409, 'CATEGORY_NOT_EMPTY'),
    });
    renderApp('/produk');
    await userEvent.click(await screen.findByRole('button', { name: 'Hapus kategori Jus Buah' }));
    expect(await screen.findByText(/Kategori masih berisi produk/)).toBeInTheDocument();
  });
});

describe('Pengaturan toko', () => {
  const settings = {
    outlet: { id: 'o1', code: 'JUS1', name: 'Jus Albert', timezone: 'Asia/Jakarta' },
    display_name: 'Jus Albert',
    address: 'Jl. Contoh No. 1',
    phone: null,
    logo_url: null,
    receipt_header: null,
    receipt_footer: 'Terima kasih!',
    qris_mode: 'static',
    qris_static_payload: null,
    qris_static_image_url: null,
    qris_embed_amount: false,
  };

  it('shows a live receipt preview and saves changes', async () => {
    const calls = mockApi({
      'POST /auth/refresh': () => json(session),
      'GET /settings': () => json(settings),
      'PATCH /settings': (b) => json({ ...settings, ...(b as object) }),
    });
    renderApp('/pengaturan');
    const preview = await screen.findByRole('figure', { name: 'Pratinjau struk' });
    expect(within(preview).getByText('Terima kasih!')).toBeInTheDocument();
    const footer = screen.getByLabelText('Footer struk');
    await userEvent.clear(footer);
    await userEvent.type(footer, 'Sampai jumpa!');
    expect(within(preview).getByText('Sampai jumpa!')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Simpan perubahan' }));
    await vi.waitFor(() =>
      expect(calls.find((c) => c.key === 'PATCH /settings')?.body).toMatchObject({
        display_name: 'Jus Albert',
        receipt_footer: 'Sampai jumpa!',
        receipt_header: null,
        phone: null,
      }),
    );
    expect(await screen.findByText('Pengaturan tersimpan.')).toBeInTheDocument();
  });

  it('shows a friendly message for an invalid QRIS payload', async () => {
    mockApi({
      'POST /auth/refresh': () => json(session),
      'GET /settings': () => json(settings),
      'PATCH /settings': () => problem(422, 'INVALID_QRIS_PAYLOAD'),
    });
    renderApp('/pengaturan');
    await userEvent.click(await screen.findByRole('button', { name: 'Simpan perubahan' }));
    expect(await screen.findByText(/Kode QRIS tidak valid/)).toBeInTheDocument();
  });
});
