import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Category, Product } from '@kelola-kasir/contracts';
import { formatRupiah } from '@kelola-kasir/money';
import { useState } from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { z } from 'zod';
import { ImageUpload } from '../components/ImageUpload';
import {
  Alert,
  Badge,
  Button,
  Card,
  CheckboxField,
  Dialog,
  EmptyState,
  Field,
  PageHeader,
  SelectField,
  Skeleton,
} from '../components/ui';
import { ApiError, api, patch, post } from '../lib/api';
import { errorMessage, toRupiah } from '../lib/format';

const CATEGORIES = ['categories'] as const;
const PRODUCTS = ['products'] as const;
const del = (path: string) => api<undefined>(path, { method: 'DELETE' });

// ---------------------------------------------------------------- categories

const categorySchema = z.object({
  name: z.string().trim().min(1, 'Nama kategori wajib diisi.').max(40, 'Maksimal 40 karakter.'),
});

function CategoryDialog({ category, onClose }: { category: Category | null; onClose: () => void }) {
  const qc = useQueryClient();
  const form = useForm<z.infer<typeof categorySchema>>({
    resolver: zodResolver(categorySchema),
    defaultValues: { name: category?.name ?? '' },
  });
  const save = useMutation({
    mutationFn: (v: z.infer<typeof categorySchema>) =>
      category
        ? patch<Category>(`/categories/${category.id}`, { ...v, sort_order: category.sort_order })
        : post<Category>('/categories', v),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: CATEGORIES });
      onClose();
    },
  });
  return (
    <Dialog title={category ? 'Ubah kategori' : 'Tambah kategori'} onClose={onClose}>
      <form
        onSubmit={(e) =>
          void form.handleSubmit((v) => save.mutateAsync(v).catch(() => undefined))(e)
        }
        noValidate
      >
        {save.error ? <Alert>{errorMessage(save.error)}</Alert> : null}
        <Field
          label="Nama kategori"
          autoComplete="off"
          error={form.formState.errors.name?.message}
          {...form.register('name')}
        />
        <div className="mt-3 flex gap-2">
          <Button type="submit" variant="primary" disabled={save.isPending}>
            Simpan
          </Button>
          <Button onClick={onClose}>Batal</Button>
        </div>
      </form>
    </Dialog>
  );
}

function CategoryRow({ category, onEdit }: { category: Category; onEdit: (c: Category) => void }) {
  const qc = useQueryClient();
  const remove = useMutation({
    mutationFn: () => del(`/categories/${category.id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: CATEGORIES }),
  });
  const notEmpty = remove.error instanceof ApiError && remove.error.code === 'CATEGORY_NOT_EMPTY';
  return (
    <li className="rounded-[14px] bg-brand-50 p-2.5">
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate font-semibold">{category.name}</span>
        <Button
          small
          onClick={() => onEdit(category)}
          aria-label={`Ubah kategori ${category.name}`}
        >
          Ubah
        </Button>
        <Button
          small
          variant="danger"
          disabled={remove.isPending}
          onClick={() => {
            if (window.confirm(`Hapus kategori "${category.name}"?`)) remove.mutate();
          }}
          aria-label={`Hapus kategori ${category.name}`}
        >
          Hapus
        </Button>
      </div>
      {remove.error ? (
        <p role="alert" className="mt-1 text-[13px] text-danger">
          {notEmpty
            ? 'Kategori masih berisi produk. Pindahkan atau hapus produknya dulu.'
            : errorMessage(remove.error)}
        </p>
      ) : null}
    </li>
  );
}

function CategoriesCard({ categories }: { categories: Category[] }) {
  const [editing, setEditing] = useState<Category | 'new' | null>(null);
  return (
    <Card className="mb-4">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 className="text-lg">Kategori</h2>
        <Button small onClick={() => setEditing('new')}>
          ＋ Tambah kategori
        </Button>
      </div>
      {categories.length === 0 ? (
        <p className="text-sm text-muted">
          Belum ada kategori. Buat kategori sebelum menambah produk.
        </p>
      ) : (
        <ul className="space-y-1.5">
          {categories.map((c) => (
            <CategoryRow key={c.id} category={c} onEdit={setEditing} />
          ))}
        </ul>
      )}
      {editing ? (
        <CategoryDialog
          category={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </Card>
  );
}

// ------------------------------------------------------------------ products

const productSchema = z.object({
  name: z.string().trim().min(1, 'Nama produk wajib diisi.').max(60, 'Maksimal 60 karakter.'),
  category_id: z.string().min(1, 'Pilih kategori.'),
  price: z
    .string()
    .refine((v) => toRupiah(v) !== null, 'Harga harus angka bulat Rupiah, mis. 15.000.')
    .refine((v) => (toRupiah(v) ?? 0) > 0, 'Harga harus lebih dari Rp0.'),
  image_url: z.string().nullable(),
  is_active: z.boolean(),
});
type ProductForm = z.infer<typeof productSchema>;

function ProductDialog({
  product,
  categories,
  onClose,
}: {
  product: Product | null;
  categories: Category[];
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const form = useForm<ProductForm>({
    resolver: zodResolver(productSchema),
    defaultValues: {
      name: product?.name ?? '',
      category_id: product?.category_id ?? categories[0]?.id ?? '',
      price: product ? String(product.price) : '',
      image_url: product?.image_url ?? null,
      is_active: product?.is_active ?? true,
    },
  });
  const save = useMutation({
    mutationFn: (v: ProductForm) => {
      const body = {
        name: v.name,
        category_id: v.category_id,
        price: toRupiah(v.price) ?? 0,
        image_url: v.image_url,
        is_active: v.is_active,
      };
      return product
        ? patch<Product>(`/products/${product.id}`, body)
        : post<Product>('/products', body);
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: PRODUCTS });
      onClose();
    },
  });
  const price = toRupiah(useWatch({ control: form.control, name: 'price' }));
  const errors = form.formState.errors;
  return (
    <Dialog title={product ? 'Ubah produk' : 'Tambah produk'} onClose={onClose}>
      <form
        onSubmit={(e) =>
          void form.handleSubmit((v) => save.mutateAsync(v).catch(() => undefined))(e)
        }
        noValidate
      >
        {save.error ? <Alert>{errorMessage(save.error)}</Alert> : null}
        <Field
          label="Nama produk"
          autoComplete="off"
          error={errors.name?.message}
          {...form.register('name')}
        />
        <SelectField
          label="Kategori"
          error={errors.category_id?.message}
          {...form.register('category_id')}
        >
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </SelectField>
        <Field
          label="Harga (Rp)"
          inputMode="numeric"
          autoComplete="off"
          hint={price !== null && price > 0 ? formatRupiah(price) : 'Contoh: 15000 atau 15.000'}
          error={errors.price?.message}
          {...form.register('price')}
        />
        <Controller
          control={form.control}
          name="image_url"
          render={({ field }) => (
            <ImageUpload
              label="Foto produk"
              purpose="product_image"
              value={field.value}
              onChange={field.onChange}
            />
          )}
        />
        <CheckboxField label="Aktif (tampil di aplikasi kasir)" {...form.register('is_active')} />
        <div className="mt-3 flex gap-2">
          <Button type="submit" variant="primary" disabled={save.isPending}>
            Simpan
          </Button>
          <Button onClick={onClose}>Batal</Button>
        </div>
      </form>
    </Dialog>
  );
}

function ProductRow({
  product,
  categoryName,
  onEdit,
}: {
  product: Product;
  categoryName: string;
  onEdit: (p: Product) => void;
}) {
  const qc = useQueryClient();
  const invalidate = () => qc.invalidateQueries({ queryKey: PRODUCTS });
  const soldOut = useMutation({
    mutationFn: () =>
      patch<Product>(`/products/${product.id}/availability`, { is_sold_out: !product.is_sold_out }),
    onSuccess: invalidate,
  });
  const remove = useMutation({
    mutationFn: () => del(`/products/${product.id}`),
    onSuccess: invalidate,
  });
  const error = soldOut.error ?? remove.error;
  return (
    <li className="flex flex-wrap items-center gap-3 rounded-[16px] bg-surface p-3 shadow-card">
      {product.image_url ? (
        <img src={product.image_url} alt="" className="size-12 rounded-[10px] object-cover" />
      ) : (
        <div
          aria-hidden="true"
          className="grid size-12 place-items-center rounded-[10px] bg-brand-50 text-xl"
        >
          🍹
        </div>
      )}
      <div className="min-w-0 flex-1">
        <p className="truncate font-bold">{product.name}</p>
        <p className="text-sm text-muted">
          {categoryName} ·{' '}
          <span className="font-semibold text-ink">{formatRupiah(product.price)}</span>
        </p>
        <div className="mt-1 flex gap-1.5">
          <Badge tone={product.is_active ? 'ok' : 'off'}>
            {product.is_active ? 'Aktif' : 'Nonaktif'}
          </Badge>
          {product.is_sold_out ? <Badge tone="warn">Habis</Badge> : null}
        </div>
        {error ? (
          <p role="alert" className="mt-1 text-[13px] text-danger">
            {errorMessage(error)}
          </p>
        ) : null}
      </div>
      <div className="flex flex-wrap gap-2">
        <Button
          small
          disabled={soldOut.isPending}
          onClick={() => soldOut.mutate()}
          aria-label={`${product.is_sold_out ? 'Tandai tersedia' : 'Tandai habis'} ${product.name}`}
        >
          {product.is_sold_out ? 'Tersedia' : 'Habis'}
        </Button>
        <Button small onClick={() => onEdit(product)} aria-label={`Ubah ${product.name}`}>
          Ubah
        </Button>
        <Button
          small
          variant="danger"
          disabled={remove.isPending}
          onClick={() => {
            if (window.confirm(`Hapus produk "${product.name}"? Riwayat transaksi tidak berubah.`))
              remove.mutate();
          }}
          aria-label={`Hapus ${product.name}`}
        >
          Hapus
        </Button>
      </div>
    </li>
  );
}

export function ProductsPage() {
  const [editing, setEditing] = useState<Product | 'new' | null>(null);
  const [categoryId, setCategoryId] = useState('');
  const [search, setSearch] = useState('');
  const cats = useQuery({
    queryKey: CATEGORIES,
    queryFn: () => api<{ data: Category[] }>('/categories'),
  });
  const products = useQuery({
    queryKey: [...PRODUCTS, categoryId, search],
    queryFn: () => {
      const q = new URLSearchParams();
      if (categoryId) q.set('category_id', categoryId);
      if (search.trim()) q.set('q', search.trim());
      const qs = q.toString();
      return api<{ data: Product[] }>(`/products${qs ? `?${qs}` : ''}`);
    },
  });
  const categories = cats.data?.data ?? [];
  const names = new Map(categories.map((c) => [c.id, c.name]));

  return (
    <>
      <PageHeader
        title="Produk"
        action={
          <Button
            variant="primary"
            disabled={categories.length === 0}
            onClick={() => setEditing('new')}
          >
            ＋ Tambah produk
          </Button>
        }
      />
      {cats.error ? <Alert>Gagal memuat kategori.</Alert> : null}
      {cats.data ? <CategoriesCard categories={categories} /> : null}
      <div className="mb-3 grid gap-x-3 sm:grid-cols-2">
        <Field
          label="Cari produk"
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          autoComplete="off"
        />
        <SelectField
          label="Filter kategori"
          value={categoryId}
          onChange={(e) => setCategoryId(e.target.value)}
        >
          <option value="">Semua kategori</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </SelectField>
      </div>
      {products.isPending ? <Skeleton /> : null}
      {products.error ? (
        <Alert>
          Gagal memuat produk.{' '}
          <button type="button" className="underline" onClick={() => void products.refetch()}>
            Coba lagi
          </button>
        </Alert>
      ) : null}
      {products.data && products.data.data.length === 0 ? (
        <Card>
          <EmptyState icon="🍹" title="Belum ada produk">
            <p>Tambahkan produk; akan muncul di aplikasi kasir setelah sinkron.</p>
          </EmptyState>
        </Card>
      ) : null}
      {products.data && products.data.data.length > 0 ? (
        <ul className="space-y-2">
          {products.data.data.map((p) => (
            <ProductRow
              key={p.id}
              product={p}
              categoryName={names.get(p.category_id) ?? '—'}
              onEdit={setEditing}
            />
          ))}
        </ul>
      ) : null}
      {editing ? (
        <ProductDialog
          product={editing === 'new' ? null : editing}
          categories={categories}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </>
  );
}
