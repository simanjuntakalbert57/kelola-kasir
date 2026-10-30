import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { errorListCsv } from './ProductImportPage';
import { json, mockApi, problem, renderApp, session } from '../test/helpers';

afterEach(() => vi.unstubAllGlobals());

const base = {
  'POST /auth/refresh': () => json(session),
  'GET /categories': () => json({ data: [{ id: 'c1', name: 'Jus Buah', sort_order: 0 }] }),
  'GET /products': () => json({ data: [] }),
};

const row = (over: Record<string, unknown>) => ({
  row: 2,
  action: 'create',
  name: 'Jus Jeruk',
  category: 'Jus Buah',
  price: 15000,
  is_favorite: false,
  is_active: true,
  product_id: null,
  category_is_new: false,
  changes: [],
  errors: [],
  ...over,
});

const preview = (rows: unknown[], summary: Record<string, number>, token: string | null) => ({
  format: 'csv',
  file_sha256: 'a'.repeat(64),
  summary: { total: rows.length, create: 0, update: 0, unchanged: 0, error: 0, ...summary },
  new_categories: [],
  rows,
  warnings: [],
  import_token: token,
  expires_at: token ? '2026-10-30T10:00:00Z' : null,
});

const file = (name = 'produk.csv') => new File(['nama;kategori\n'], name, { type: 'text/csv' });

async function upload(f: File) {
  renderApp('/produk/impor');
  await screen.findByRole('heading', { name: 'Impor produk dari file' });
  await userEvent.upload(screen.getByLabelText('File impor produk'), f);
}

describe('Impor produk', () => {
  it('has an entry button on the Produk page', async () => {
    mockApi({
      ...base,
      'GET /products': () =>
        json({
          data: [
            {
              id: 'p1',
              category_id: 'c1',
              name: 'Jus',
              price: 1000,
              is_active: true,
              is_sold_out: false,
              image_url: null,
            },
          ],
        }),
    });
    renderApp('/produk');
    expect(await screen.findByRole('link', { name: 'Impor produk' })).toHaveAttribute(
      'href',
      '/produk/impor',
    );
  });

  it('shows row errors with API messages and keeps Simpan disabled', async () => {
    mockApi({
      ...base,
      'POST /products/import/preview': () =>
        json(
          preview(
            [
              row({}),
              row({
                row: 3,
                action: 'error',
                name: 'Jus Mangga',
                price: null,
                errors: [
                  {
                    column: 'harga',
                    code: 'INVALID_PRICE',
                    message: 'Harga harus angka bulat, contoh 15000',
                  },
                ],
              }),
            ],
            { create: 1, error: 1 },
            null,
          ),
        ),
    });
    await upload(file());
    expect(await screen.findByText('Harga harus angka bulat, contoh 15000')).toBeInTheDocument();
    expect(screen.getByText(/1 baris perlu diperbaiki/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Simpan/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Daftar error (.csv)' })).toBeInTheDocument();
  });

  it('rejects wrong type and oversize before uploading', async () => {
    const calls = mockApi(base);
    renderApp('/produk/impor');
    await screen.findByRole('heading', { name: 'Impor produk dari file' });
    await userEvent.upload(screen.getByLabelText('File impor produk'), new File(['x'], 'a.pdf'), {
      applyAccept: false,
    });
    expect(await screen.findByText(/Gunakan file .xlsx atau .csv/)).toBeInTheDocument();
    expect(calls.some((c) => c.key.includes('import/preview'))).toBe(false);
    const big = file('besar.csv');
    Object.defineProperty(big, 'size', { value: 3 * 1024 * 1024 });
    await userEvent.upload(screen.getByLabelText('File impor produk'), big);
    expect(await screen.findByText(/File terlalu besar/)).toBeInTheDocument();
    expect(calls.some((c) => c.key.includes('import/preview'))).toBe(false);
  });

  it('saves the same file with the token and shows success', async () => {
    const calls = mockApi({
      ...base,
      'POST /products/import/preview': () =>
        json(preview([row({}), row({ row: 3, name: 'Jus Alpukat' })], { create: 2 }, 'tok-1')),
      'POST /products/import/commit': () =>
        json({ created: 2, updated: 0, unchanged: 0, categories_created: 0 }),
    });
    await upload(file());
    const save = await screen.findByRole('button', { name: 'Simpan 2 produk' });
    expect(save).toBeEnabled();
    await userEvent.click(save);
    expect(
      await screen.findByRole('heading', { name: '2 produk berhasil disimpan' }),
    ).toBeInTheDocument();
    const commit = calls.find((c) => c.key === 'POST /products/import/commit');
    expect(commit?.body).toMatchObject({ import_token: 'tok-1' });
    expect((commit?.body as { file: File }).file.name).toBe('produk.csv');
    expect(screen.getByRole('link', { name: 'Lihat daftar produk' })).toBeInTheDocument();
  });

  it('on IMPORT_STALE previews again with the same file', async () => {
    let previews = 0;
    const calls = mockApi({
      ...base,
      'POST /products/import/preview': () => {
        previews += 1;
        return json(preview([row({})], { create: 1 }, `tok-${previews}`));
      },
      'POST /products/import/commit': () => problem(409, 'IMPORT_STALE'),
    });
    await upload(file());
    await userEvent.click(await screen.findByRole('button', { name: 'Simpan 1 produk' }));
    expect(await screen.findByText(/Katalog berubah, unggah ulang/)).toBeInTheDocument();
    await waitFor(() => expect(previews).toBe(2));
    const second = calls.filter((c) => c.key === 'POST /products/import/preview')[1];
    expect((second?.body as { file: File }).file.name).toBe('produk.csv');
    expect(await screen.findByRole('button', { name: 'Simpan 1 produk' })).toBeEnabled();
  });

  it('disables Simpan when every row is unchanged (no token)', async () => {
    mockApi({
      ...base,
      'POST /products/import/preview': () =>
        json(preview([row({ action: 'unchanged', product_id: 'p1' })], { unchanged: 1 }, null)),
    });
    await upload(file());
    expect(await screen.findByText(/Tidak ada perubahan/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Simpan/ })).toBeDisabled();
  });

  it('maps file-level API errors to clear messages', async () => {
    mockApi({
      ...base,
      'POST /products/import/preview': () => problem(422, 'IMPORT_FILE_UNREADABLE'),
    });
    await upload(file());
    expect(await screen.findByText(/File tidak bisa dibuka/)).toBeInTheDocument();
  });

  it('ignores a file dropped while saving', async () => {
    let release: (r: Response) => void = () => {};
    const calls = mockApi({
      ...base,
      'POST /products/import/preview': () => json(preview([row({})], { create: 1 }, 'tok-1')),
      'POST /products/import/commit': () => new Promise<Response>((r) => (release = r)),
    });
    await upload(file());
    await userEvent.click(await screen.findByRole('button', { name: 'Simpan 1 produk' }));
    await waitFor(() => expect(calls.some((c) => c.key.includes('import/commit'))).toBe(true));
    await userEvent.upload(screen.getByLabelText('File impor produk'), file('lain.csv'));
    expect(calls.filter((c) => c.key.includes('import/preview'))).toHaveLength(1);
    release(json({ created: 1, updated: 0, unchanged: 0, categories_created: 0 }));
    expect(
      await screen.findByRole('heading', { name: '1 produk berhasil disimpan' }),
    ).toBeInTheDocument();
  });

  it('neutralises formulas in the error list CSV', async () => {
    const blob = errorListCsv([
      row({ errors: [{ column: 'nama', code: 'X', message: '=HYPERLINK("http://x")' }] }) as never,
      row({ row: 3, errors: [{ column: 'nama', code: 'X', message: 'Harga salah' }] }) as never,
    ]);
    const text = await blob.text();
    expect(text).toContain(`"'=HYPERLINK(""http://x"")"`);
    expect(text).toContain('"Harga salah"');
  });
});
