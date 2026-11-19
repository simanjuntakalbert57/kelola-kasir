import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  DiscountDetail,
  DiscountInput,
  DiscountTargetOptions,
  DiscountUpdate,
} from '@kelola-kasir/contracts';
import { discountPerUnit, formatRupiah, parseClock } from '@kelola-kasir/money';
import { useNavigate, useParams } from '@tanstack/react-router';
import { useState } from 'react';
import { ownedOutlets, useAuth } from '../auth/AuthProvider';
import {
  Alert,
  Button,
  Card,
  CheckboxField,
  ErrorState,
  Field,
  PageHeader,
  Skeleton,
} from '../components/ui';
import { ApiError, api, patch, post, qs } from '../lib/api';
import { wibDate } from '../lib/dates';
import { DISCOUNT_KEY, WEEKDAYS, discountErrorMessage } from '../lib/discounts';

type Kind = 'product' | 'category';
type Options = DiscountTargetOptions;

const chip = (on: boolean) =>
  `min-h-11 min-w-11 rounded-full px-3 text-sm font-extrabold ring-2 ring-inset ${
    on ? 'bg-pri text-pri-ink ring-pri' : 'bg-surface text-ink ring-line-strong'
  }`;

interface FormState {
  name: string;
  kind: Kind;
  keys: string[];
  type: 'percent' | 'amount';
  value: string;
  startsOn: string;
  endsOn: string;
  days: number[];
  timeStart: string;
  timeEnd: string;
}

const EMPTY = (): FormState => ({
  name: '',
  kind: 'product',
  keys: [],
  type: 'percent',
  value: '',
  startsOn: wibDate(),
  endsOn: '',
  days: [],
  timeStart: '',
  timeEnd: '',
});

function fromDetail(d: DiscountDetail, options: Options): FormState {
  const ids = new Set(
    d.outlets.flatMap((o) => [...o.products.map((p) => p.id), ...o.categories.map((c) => c.id)]),
  );
  const keys =
    d.target_type === 'product'
      ? options.products
          .filter((p) => p.outlets.some((o) => ids.has(o.product_id)))
          .map((p) => p.key)
      : options.categories
          .filter((c) => c.outlets.some((o) => ids.has(o.category_id)))
          .map((c) => c.key);
  return {
    name: d.name,
    kind: d.target_type,
    keys,
    type: d.type,
    value: String(d.value),
    startsOn: d.starts_on,
    endsOn: d.ends_on ?? '',
    days: d.days_of_week ?? [],
    timeStart: d.time_start ?? '',
    timeEnd: d.time_end ?? '',
  };
}

export function validate(f: FormState): Record<string, string> {
  const e: Record<string, string> = {};
  const name = f.name.trim();
  if (!name) e['name'] = 'Nama promo wajib diisi.';
  else if (name.length > 60) e['name'] = 'Maksimal 60 karakter.';
  if (f.keys.length === 0) e['target'] = 'Pilih minimal satu produk atau kategori.';
  if (f.keys.length > 200) e['target'] = 'Maksimal 200 pilihan.';
  const v = Number(f.value);
  if (!f.value || !Number.isInteger(v) || v < 1) e['value'] = 'Isi angka bulat lebih dari 0.';
  else if (f.type === 'percent' && v > 100) e['value'] = 'Persen maksimal 100.';
  else if (f.type === 'amount' && v > 100_000_000) e['value'] = 'Terlalu besar.';
  if (!f.startsOn) e['startsOn'] = 'Tanggal mulai wajib diisi.';
  if (f.endsOn && f.startsOn && f.endsOn < f.startsOn)
    e['endsOn'] = 'Tanggal selesai tidak boleh sebelum tanggal mulai.';
  if (Boolean(f.timeStart) !== Boolean(f.timeEnd)) e['time'] = 'Isi jam mulai dan jam selesai.';
  else if (f.timeStart && f.timeEnd && parseClock(f.timeStart) >= parseClock(f.timeEnd))
    e['time'] = 'Jam selesai harus setelah jam mulai (tidak lewat tengah malam).';
  return e;
}

/** Final price per product of the selection, using the shared formula (same as the cashier app). */
function previewRows(options: Options, f: FormState) {
  if (f.kind !== 'product') return [];
  const v = Number(f.value);
  if (!Number.isInteger(v) || v < 1 || (f.type === 'percent' && v > 100)) return [];
  return options.products
    .filter((p) => f.keys.includes(p.key))
    .flatMap((p) =>
      p.outlets.map((o) => {
        const off = discountPerUnit(o.price, f.type, v);
        return {
          id: o.product_id,
          name: p.name,
          branch: o.outlet.code,
          price: o.price,
          final: o.price - off,
        };
      }),
    );
}

function Form({
  options,
  detail,
  multi,
  scope,
  onScope,
  conflict,
  onConflict,
}: {
  options: Options;
  detail: DiscountDetail | undefined;
  multi: boolean;
  scope: 'current' | 'all';
  onScope: (s: 'current' | 'all') => void;
  conflict: string | null;
  onConflict: (message: string | null) => void;
}) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [f, setF] = useState<FormState>(() => (detail ? fromDetail(detail, options) : EMPTY()));
  const [touched, setTouched] = useState(false);
  const [search, setSearch] = useState('');
  const errors = validate(f);
  const set = (patchState: Partial<FormState>) => setF((s) => ({ ...s, ...patchState }));

  const save = useMutation({
    mutationFn: async () => {
      const v = Number(f.value);
      const chosen =
        f.kind === 'product'
          ? options.products
              .filter((p) => f.keys.includes(p.key))
              .flatMap((p) => p.outlets.map((o) => o.product_id))
          : options.categories
              .filter((c) => f.keys.includes(c.key))
              .flatMap((c) => c.outlets.map((o) => o.category_id));
      const common = {
        name: f.name.trim(),
        target_type: f.kind,
        type: f.type,
        value: v,
        starts_on: f.startsOn,
        ends_on: f.endsOn || null,
        days_of_week: f.days.length === 0 || f.days.length === 7 ? null : [...f.days].sort(),
        time_start: f.timeStart || null,
        time_end: f.timeEnd || null,
        ...(f.kind === 'product' ? { product_ids: chosen } : { category_ids: chosen }),
      };
      if (detail) {
        const body: DiscountUpdate = { version: detail.version, ...common };
        return patch(`/discounts/${detail.id}`, body);
      }
      const body: DiscountInput = { ...common, is_active: true };
      return post('/discounts', body);
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: DISCOUNT_KEY });
      await navigate({ to: '/diskon' });
    },
    onError: async (e) => {
      if (e instanceof ApiError && e.code === 'DISCOUNT_VERSION_CONFLICT') {
        // Reload the latest version so the next save is based on it.
        await qc.invalidateQueries({ queryKey: [...DISCOUNT_KEY, 'detail'] });
        onConflict(discountErrorMessage(e));
      }
    },
  });

  const list = f.kind === 'product' ? options.products : options.categories;
  const shown = list.filter((x) => x.name.toLowerCase().includes(search.trim().toLowerCase()));
  const rows = previewRows(options, f);
  const toggleKey = (key: string) =>
    set({ keys: f.keys.includes(key) ? f.keys.filter((k) => k !== key) : [...f.keys, key] });
  const show = (k: string) => (touched ? errors[k] : undefined);

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        setTouched(true);
        onConflict(null);
        if (Object.keys(errors).length === 0) save.mutate();
      }}
      noValidate
    >
      {conflict ? <Alert tone="warn">{conflict}</Alert> : null}
      {save.error && !conflict ? <Alert>{discountErrorMessage(save.error)}</Alert> : null}
      <Card className="mb-3">
        <Field
          label="Nama promo"
          value={f.name}
          maxLength={80}
          onChange={(e) => set({ name: e.target.value })}
          error={show('name')}
        />
        <fieldset className="mb-3.5">
          <legend className="mb-1 text-sm font-extrabold">Berlaku untuk</legend>
          <div className="flex gap-2">
            {(['product', 'category'] as const).map((k) => (
              <button
                key={k}
                type="button"
                aria-pressed={f.kind === k}
                className={chip(f.kind === k)}
                onClick={() => set({ kind: k, keys: [] })}
              >
                {k === 'product' ? 'Produk' : 'Kategori'}
              </button>
            ))}
          </div>
        </fieldset>
        {multi ? (
          <CheckboxField
            label="Semua cabang"
            checked={scope === 'all'}
            disabled={Boolean(detail)}
            onChange={(e) => {
              set({ keys: [] });
              onScope(e.target.checked ? 'all' : 'current');
            }}
          />
        ) : null}
        <Field
          label={f.kind === 'product' ? 'Cari produk' : 'Cari kategori'}
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          autoComplete="off"
        />
        <ul
          aria-label="Pilihan target"
          className="max-h-56 overflow-y-auto rounded-2xl ring-1 ring-line-strong ring-inset"
        >
          {shown.map((x) => (
            <li key={x.key} className="border-b border-line last:border-0">
              <label className="flex min-h-12 items-center gap-3 px-3">
                <input
                  type="checkbox"
                  className="size-5 accent-pri"
                  checked={f.keys.includes(x.key)}
                  onChange={() => toggleKey(x.key)}
                />
                <span className="min-w-0 flex-1 truncate font-bold">{x.name}</span>
                {scope === 'all' ? (
                  <small className="text-muted">
                    {x.outlets.map((o) => o.outlet.code).join(' · ')}
                  </small>
                ) : null}
              </label>
            </li>
          ))}
          {shown.length === 0 ? <li className="p-3 text-sm text-muted">Tidak ketemu.</li> : null}
        </ul>
        {show('target') ? (
          <p role="alert" className="mt-1 text-[13px] text-danger">
            {show('target')}
          </p>
        ) : (
          <p className="mt-1 text-[13px] text-muted">{f.keys.length} dipilih</p>
        )}
      </Card>

      <Card className="mb-3">
        <fieldset className="mb-3.5">
          <legend className="mb-1 text-sm font-extrabold">Jenis potongan</legend>
          <div className="flex gap-2">
            <button
              type="button"
              aria-pressed={f.type === 'percent'}
              className={chip(f.type === 'percent')}
              onClick={() => set({ type: 'percent' })}
            >
              Persen (%)
            </button>
            <button
              type="button"
              aria-pressed={f.type === 'amount'}
              className={chip(f.type === 'amount')}
              onClick={() => set({ type: 'amount' })}
            >
              Rupiah (Rp)
            </button>
          </div>
        </fieldset>
        <Field
          label={f.type === 'percent' ? 'Potongan (%)' : 'Potongan per cup (Rp)'}
          inputMode="numeric"
          value={f.value}
          onChange={(e) => set({ value: e.target.value.replace(/\D/g, '') })}
          error={show('value')}
        />
        {rows.length > 0 ? (
          <div aria-label="Pratinjau harga akhir" className="rounded-2xl bg-bg p-3 text-sm">
            <b className="mb-1 block">Pratinjau harga akhir</b>
            <ul className="space-y-0.5 tabular-nums">
              {rows.slice(0, 8).map((r) => (
                <li key={r.id} className="flex justify-between gap-2">
                  <span className="truncate">
                    {r.name}
                    {scope === 'all' ? ` (${r.branch})` : ''}
                  </span>
                  <span>
                    <s className="text-muted">{formatRupiah(r.price)}</s> →{' '}
                    <b>{formatRupiah(r.final)}</b>
                  </span>
                </li>
              ))}
            </ul>
            {rows.length > 8 ? <p className="text-muted">+{rows.length - 8} lainnya</p> : null}
          </div>
        ) : f.kind === 'category' ? (
          <p className="text-[13px] text-muted">
            Diskon kategori berlaku untuk semua produk di dalamnya, termasuk produk baru.
          </p>
        ) : null}
      </Card>

      <Card className="mb-3">
        <div className="grid gap-x-3 sm:grid-cols-2">
          <Field
            label="Mulai"
            type="date"
            value={f.startsOn}
            onChange={(e) => set({ startsOn: e.target.value })}
            error={show('startsOn')}
          />
          <Field
            label="Selesai (kosongkan = tanpa batas)"
            type="date"
            value={f.endsOn}
            onChange={(e) => set({ endsOn: e.target.value })}
            error={show('endsOn')}
          />
        </div>
        <fieldset className="mb-3.5">
          <legend className="mb-1 text-sm font-extrabold">Hari (kosong = setiap hari)</legend>
          <div className="flex flex-wrap gap-2">
            {WEEKDAYS.map((w) => {
              const on = f.days.includes(w.n);
              return (
                <button
                  key={w.n}
                  type="button"
                  aria-pressed={on}
                  aria-label={w.long}
                  className={chip(on)}
                  onClick={() =>
                    set({ days: on ? f.days.filter((d) => d !== w.n) : [...f.days, w.n] })
                  }
                >
                  {w.short}
                </button>
              );
            })}
          </div>
        </fieldset>
        <div className="grid gap-x-3 sm:grid-cols-2">
          <Field
            label="Jam mulai"
            type="time"
            value={f.timeStart}
            onChange={(e) => set({ timeStart: e.target.value })}
            error={show('time')}
          />
          <Field
            label="Jam selesai"
            type="time"
            value={f.timeEnd}
            onChange={(e) => set({ timeEnd: e.target.value })}
          />
        </div>
        <p className="text-[13px] text-muted">Waktu WIB. Jam selesai tidak ikut dihitung.</p>
      </Card>

      <div className="flex gap-2">
        <Button variant="primary" type="submit" disabled={save.isPending}>
          {save.isPending ? 'Menyimpan…' : 'Simpan'}
        </Button>
        <Button onClick={() => void navigate({ to: '/diskon' })}>Batal</Button>
      </div>
    </form>
  );
}

/** Create (`/diskon/baru`) or edit (`/diskon/:id`) a discount. Owner only. */
export function DiscountFormPage() {
  const { id } = useParams({ strict: false }) as { id?: string };
  const { role, user } = useAuth();
  const multi = ownedOutlets(user).length >= 2;
  const [scope, setScope] = useState<'current' | 'all'>('current');
  const [conflict, setConflict] = useState<string | null>(null);
  const detail = useQuery({
    queryKey: [...DISCOUNT_KEY, 'detail', id],
    queryFn: () => api<DiscountDetail>(`/discounts/${id}`),
    enabled: Boolean(id),
  });
  const editScope = (detail.data?.outlets.length ?? 0) > 1 ? 'all' : scope;
  const options = useQuery({
    queryKey: [...DISCOUNT_KEY, 'options', editScope],
    queryFn: () => api<Options>(`/discounts/target-options${qs({ outlet_scope: editScope })}`),
    enabled: role === 'owner' && (!id || detail.data !== undefined),
  });
  if (role !== 'owner') {
    return (
      <>
        <PageHeader title="Diskon" />
        <Alert>Hanya pemilik yang bisa membuat atau mengubah diskon.</Alert>
      </>
    );
  }
  const pending = options.isPending || (Boolean(id) && detail.isPending);
  const error = options.error ?? detail.error;
  return (
    <>
      <PageHeader title={id ? 'Ubah diskon' : 'Buat diskon'} />
      {pending && !error ? <Skeleton rows={4} /> : null}
      {error ? (
        <ErrorState
          onRetry={() => {
            void options.refetch();
            void detail.refetch();
          }}
        >
          {discountErrorMessage(error)}
        </ErrorState>
      ) : null}
      {options.data && (!id || detail.data) ? (
        <Form
          // Re-seed when the discount was reloaded after a version conflict.
          key={`${id ?? 'new'}-${detail.data?.version ?? 0}`}
          options={options.data}
          detail={detail.data}
          multi={multi}
          scope={editScope}
          onScope={setScope}
          conflict={conflict}
          onConflict={setConflict}
        />
      ) : null}
    </>
  );
}
