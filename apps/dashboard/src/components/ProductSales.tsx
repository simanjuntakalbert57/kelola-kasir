import { keepPreviousData, useMutation, useQuery } from '@tanstack/react-query';
import type { components } from '@kelola-kasir/contracts';
import { formatRupiah } from '@kelola-kasir/money';
import { Banknote, Download, QrCode, Search, TrendingDown, TrendingUp, X } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ApiError, api, download, qs } from '../lib/api';
import { formatShortDate, formatTime } from '../lib/dates';
import { errorMessage } from '../lib/format';
import { useDebounced } from '../lib/useDebounced';
import { useIsDesktop } from '../lib/useMediaQuery';
import { Button, Card, EmptyState, ErrorState, Skeleton } from './ui';

type Report = components['schemas']['ProductSalesReport'];
type Row = components['schemas']['ProductSalesRow'];
type Detail = components['schemas']['ProductSalesDetail'];
type SeriesPoint = { bucket_start: string; items_sold: number; revenue: number };
type Sort = 'items_sold' | 'revenue' | 'share_pct' | 'name';
type Order = 'asc' | 'desc';
type Scope = 'current' | 'all';

export interface Period {
  date_from: string;
  date_to: string;
}

const cups = new Intl.NumberFormat('id-ID');
const oneDecimal = new Intl.NumberFormat('id-ID', {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

const SORTS: { key: Sort; label: string }[] = [
  { key: 'items_sold', label: 'Cup' },
  { key: 'revenue', label: 'Total Rp' },
  { key: 'share_pct', label: '% omzet' },
  { key: 'name', label: 'Nama' },
];
const defaultOrder = (sort: Sort): Order => (sort === 'name' ? 'asc' : 'desc');

/** Spans between two `YYYY-MM-DD` dates, inclusive. */
function dayCount(p: Period): number {
  const t = (d: string) => Date.parse(`${d}T00:00:00Z`);
  return Math.round((t(p.date_to) - t(p.date_from)) / 86_400_000) + 1;
}

function Delta({ pct, vs }: { pct: number | null | undefined; vs: string }) {
  if (typeof pct !== 'number') return null;
  const Icon = pct >= 0 ? TrendingUp : TrendingDown;
  return (
    <span className="inline-flex items-center gap-1 text-[13px] font-bold text-muted">
      <Icon size={14} aria-hidden="true" />
      {pct >= 0 ? 'Naik' : 'Turun'} {oneDecimal.format(Math.abs(pct))}% {vs}
    </span>
  );
}

function ShareBar({ pct, dim }: { pct: number; dim?: boolean }) {
  return (
    <div aria-hidden="true" className="h-2 overflow-hidden rounded-full bg-tint">
      <div className={`h-full ${dim ? 'bg-dis-bg' : 'bg-pri'}`} style={{ width: `${pct}%` }} />
    </div>
  );
}

export function ProductSalesCard({
  period,
  scope,
  selectedId,
  onOpen,
  onResetFilter,
  onToast,
}: {
  period: Period;
  scope: Scope;
  selectedId: string | undefined;
  onOpen: (productId: string, trigger: HTMLElement) => void;
  onResetFilter: () => void;
  onToast: (message: string) => void;
}) {
  const desktop = useIsDesktop();
  const [search, setSearch] = useState('');
  const q = useDebounced(search.trim(), 300);
  const [sort, setSort] = useState<Sort>('items_sold');
  const [order, setOrder] = useState<Order>('desc');
  const [expanded, setExpanded] = useState(false);
  const limit = desktop ? 8 : 5;

  const params = { ...period, outlet_scope: scope, sort, order };
  const report = useQuery({
    queryKey: ['reports', 'products', scope, period.date_from, period.date_to, sort, order, q],
    queryFn: () => api<Report>(`/reports/products${qs({ ...params, q })}`),
    placeholderData: keepPreviousData,
  });

  const exportXlsx = useMutation({
    mutationFn: async () => {
      const { blob, filename } = await download(
        `/reports/products/export${qs({ ...params, format: 'xlsx' })}`,
      );
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename.includes('.') ? filename : `${filename}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
    },
    onError: (e) => onToast(errorMessage(e)),
  });

  const pickSort = (next: Sort) => {
    if (next === sort) setOrder(order === 'asc' ? 'desc' : 'asc');
    else {
      setSort(next);
      setOrder(defaultOrder(next));
    }
  };

  const data = report.data;
  const all = data?.data ?? [];
  // The short list hides products without sales; the full list and search results show them.
  const full = expanded || q !== '';
  const shown = full ? all : all.filter((r) => r.has_sales).slice(0, limit);
  const canExpand = !q && (expanded || all.length > shown.length);
  const noSales = !!data && !q && !all.some((r) => r.has_sales);
  const sortLabel = SORTS.find((s) => s.key === sort)?.label ?? '';

  let body: ReactNode;
  if (report.error) {
    body = (
      <ErrorState
        title="Data penjualan produk belum bisa dimuat"
        onRetry={() => void report.refetch()}
      >
        Cek sinyal, lalu coba lagi ya.
      </ErrorState>
    );
  } else if (!data) {
    body = <Skeleton rows={5} />;
  } else if (noSales) {
    body = (
      <EmptyState icon="🍹" title="Belum ada penjualan di periode ini">
        <Button onClick={onResetFilter}>Atur ulang filter</Button>
      </EmptyState>
    );
  } else if (shown.length === 0) {
    body = <p className="py-6 text-center text-muted">Produk “{q}” tidak ditemukan.</p>;
  } else {
    body = (
      <>
        {desktop ? (
          <div
            role="row"
            className="grid grid-cols-[minmax(0,1fr)_72px_120px_150px] gap-3 border-b border-line px-2 pb-2 text-[13px] font-bold text-muted"
          >
            <HeaderCell
              label="Produk"
              sort="name"
              cur={sort}
              order={order}
              onSort={pickSort}
              align="left"
            />
            <HeaderCell label="Cup" sort="items_sold" cur={sort} order={order} onSort={pickSort} />
            <HeaderCell label="Total" sort="revenue" cur={sort} order={order} onSort={pickSort} />
            <HeaderCell
              label="% omzet"
              sort="share_pct"
              cur={sort}
              order={order}
              onSort={pickSort}
            />
          </div>
        ) : null}
        <ul>
          {shown.map((r) => (
            <ProductRow
              key={r.key}
              row={r}
              desktop={desktop}
              selected={r.product_id === selectedId}
              onOpen={onOpen}
            />
          ))}
        </ul>
        {canExpand ? (
          <div className="mt-2 text-center">
            <Button small aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>
              {expanded ? 'Tampilkan 8 teratas' : `Lihat semua ${data.totals.product_count} produk`}
            </Button>
          </div>
        ) : null}
      </>
    );
  }

  return (
    <Card className="mt-3 min-w-0">
      <section aria-label="Penjualan per Produk">
        <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-lg">Penjualan per Produk</h2>
            <p className="text-sm text-muted">
              Mengikuti filter di atas{data ? ` · ${data.totals.product_count} produk` : ''}
            </p>
          </div>
          <Button
            small
            disabled={exportXlsx.isPending || !data}
            onClick={() => exportXlsx.mutate()}
          >
            <Download size={18} aria-hidden="true" />
            {exportXlsx.isPending ? 'Menyiapkan…' : 'Ekspor Excel'}
          </Button>
        </div>
        <div className="mb-3 flex flex-wrap gap-2">
          <label className="relative min-w-0 flex-1">
            <span className="sr-only">Cari produk</span>
            <Search
              size={18}
              aria-hidden="true"
              className="absolute top-1/2 left-3 -translate-y-1/2 text-muted"
            />
            <input
              type="search"
              value={search}
              maxLength={100}
              placeholder="Cari produk"
              onChange={(e) => setSearch(e.target.value)}
              className="min-h-12 w-full rounded-[16px] border-2 border-line-strong bg-surface pr-3 pl-10"
            />
          </label>
          {desktop ? null : (
            <label className="flex items-center gap-2 text-sm font-bold">
              Urut
              <select
                value={sort}
                onChange={(e) => {
                  setSort(e.target.value as Sort);
                  setOrder(defaultOrder(e.target.value as Sort));
                }}
                className="min-h-12 rounded-[16px] border-2 border-line-strong bg-surface px-3"
              >
                {SORTS.map((s) => (
                  <option key={s.key} value={s.key}>
                    {s.label}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
        <p aria-live="polite" className="sr-only">
          {data
            ? `${q ? `${all.length} produk cocok. ` : ''}Diurutkan menurut ${sortLabel}, ${order === 'asc' ? 'naik' : 'turun'}.`
            : ''}
        </p>
        {body}
      </section>
    </Card>
  );
}

function HeaderCell({
  label,
  sort,
  cur,
  order,
  onSort,
  align = 'right',
}: {
  label: string;
  sort: Sort;
  cur: Sort;
  order: Order;
  onSort: (s: Sort) => void;
  align?: 'left' | 'right';
}) {
  const active = sort === cur;
  return (
    <span
      role="columnheader"
      aria-sort={active ? (order === 'asc' ? 'ascending' : 'descending') : 'none'}
      className={align === 'left' ? 'text-left' : 'text-right'}
    >
      <button
        type="button"
        onClick={() => onSort(sort)}
        className={`min-h-11 rounded-lg px-1 font-bold ${active ? 'text-ink' : ''}`}
      >
        {label}
        {active ? <span aria-hidden="true">{order === 'asc' ? ' ↑' : ' ↓'}</span> : null}
      </button>
    </span>
  );
}

function ProductRow({
  row,
  desktop,
  selected,
  onOpen,
}: {
  row: Row;
  desktop: boolean;
  selected: boolean;
  onOpen: (productId: string, trigger: HTMLElement) => void;
}) {
  const dim = !row.has_sales;
  const name = (
    <span className="min-w-0">
      <span className="block truncate font-extrabold">{row.product_name}</span>
      <span className="block truncate text-[13px] text-muted">
        {row.category_name ?? 'Tanpa kategori'}
        {dim ? (
          <span className="ml-2 rounded-full bg-dis-bg px-2 py-0.5 text-dis-ink">
            Belum terjual
          </span>
        ) : null}
      </span>
    </span>
  );
  const layout = desktop
    ? 'grid-cols-[minmax(0,1fr)_72px_120px_150px] items-center'
    : 'grid-cols-[minmax(0,1fr)_auto] items-center';
  const content = desktop ? (
    <>
      {name}
      <span className="text-right tabular-nums">{cups.format(row.items_sold)}</span>
      <span className="text-right tabular-nums">{formatRupiah(row.revenue)}</span>
      <span className="grid gap-1 text-right tabular-nums">
        {oneDecimal.format(row.share_pct)}%
        <ShareBar pct={row.share_pct} dim={dim} />
      </span>
    </>
  ) : (
    <>
      {name}
      <span className="text-right tabular-nums">
        <span className="block font-extrabold">{cups.format(row.items_sold)} cup</span>
        <span className="block text-[13px] text-muted">
          {formatRupiah(row.revenue)} · {oneDecimal.format(row.share_pct)}%
        </span>
      </span>
      <span className="col-span-2">
        <ShareBar pct={row.share_pct} dim={dim} />
      </span>
    </>
  );
  const cls = `grid min-h-12 w-full gap-x-3 gap-y-1 border-b border-line px-2 py-2 text-left ${layout} ${dim ? 'text-muted' : ''}`;
  return (
    <li>
      {row.product_id ? (
        <button
          type="button"
          aria-current={selected || undefined}
          onClick={(e) => onOpen(row.product_id as string, e.currentTarget)}
          className={`${cls} rounded-lg hover:bg-tint ${selected ? 'bg-tint' : ''}`}
        >
          {content}
        </button>
      ) : (
        <div className={cls}>{content}</div>
      )}
    </li>
  );
}

function CupChart({ data, granularity }: { data: SeriesPoint[]; granularity: 'hour' | 'day' }) {
  const max = Math.max(1, ...data.map((d) => d.items_sold));
  const label = (d: SeriesPoint) =>
    granularity === 'hour'
      ? formatTime(d.bucket_start).slice(0, 2)
      : formatShortDate(d.bucket_start);
  const peak = data.reduce((b, d) => (d.items_sold > b.items_sold ? d : b), data[0] as SeriesPoint);
  return (
    <figure>
      <div
        role="img"
        aria-label={`Cup per ${granularity === 'hour' ? 'jam' : 'hari'}, puncak ${label(peak)} sebanyak ${peak.items_sold} cup`}
        className="flex h-32 items-end gap-1"
      >
        {data.map((d) => (
          <div
            key={d.bucket_start}
            title={`${label(d)}: ${d.items_sold} cup (${formatRupiah(d.revenue)})`}
            className={`min-w-1 flex-1 rounded-t-[4px] ${d === peak && d.items_sold > 0 ? 'bg-pri' : 'bg-bar'}`}
            style={{ height: `${Math.max(2, (d.items_sold / max) * 100)}%` }}
          />
        ))}
      </div>
      <div aria-hidden="true" className="mt-1 flex gap-1 text-[11px] text-muted">
        {data.map((d) => (
          <span key={d.bucket_start} className="min-w-1 flex-1 overflow-hidden text-center">
            {label(d)}
          </span>
        ))}
      </div>
    </figure>
  );
}

function Stat({ label, children, note }: { label: string; children: ReactNode; note?: ReactNode }) {
  return (
    <div className="min-w-0 rounded-2xl bg-tint p-3">
      <p className="text-[13px] font-bold text-muted">{label}</p>
      <p className="text-lg leading-6 font-extrabold tabular-nums">{children}</p>
      {note ? <p className="text-[13px] font-bold text-muted">{note}</p> : null}
    </div>
  );
}

export function ProductDetailPanel({
  productId,
  name,
  period,
  scope,
  vsWord,
  onClose,
  onNotFound,
}: {
  productId: string;
  name: string | undefined;
  period: Period;
  scope: Scope;
  vsWord: string;
  onClose: () => void;
  onNotFound: () => void;
}) {
  const ref = useRef<HTMLElement>(null);
  const days = dayCount(period);
  const [picked, setGranularity] = useState<'hour' | 'day' | null>(null);
  const granularity = picked ?? (days <= 3 ? 'hour' : 'day');

  const detail = useQuery({
    queryKey: ['reports', 'product', productId, scope, period.date_from, period.date_to],
    queryFn: () =>
      api<Detail>(`/reports/products/${productId}${qs({ ...period, outlet_scope: scope })}`),
  });
  const series = useQuery({
    queryKey: [
      'reports',
      'product-series',
      productId,
      scope,
      period.date_from,
      period.date_to,
      granularity,
    ],
    queryFn: () =>
      api<{ data: SeriesPoint[] }>(
        `/reports/products/${productId}/series${qs({ ...period, outlet_scope: scope, granularity })}`,
      ),
  });

  const notFound = detail.error instanceof ApiError && detail.error.status === 404;
  useEffect(() => {
    if (notFound) onNotFound();
  }, [notFound, onNotFound]);

  useEffect(() => {
    ref.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const d = detail.data;
  const title = d?.product_name ?? name ?? 'produk';
  const cash = d?.by_payment_method.find((m) => m.method === 'cash');
  const qris = d?.by_payment_method.find((m) => m.method === 'qris');

  return (
    <>
      <div
        aria-hidden="true"
        className="fixed inset-0 z-30 bg-ink/40 xl:hidden"
        onClick={onClose}
      />
      <aside
        ref={ref}
        role="dialog"
        aria-label={`Detail ${title}`}
        tabIndex={-1}
        className="fixed inset-x-0 top-8 bottom-0 z-40 overflow-y-auto rounded-t-[28px] bg-surface p-5 text-ink shadow-modal md:top-0 md:left-auto md:w-[470px] md:rounded-none xl:sticky xl:top-4 xl:z-auto xl:max-h-[calc(100vh-2rem)] xl:shrink-0 xl:self-start xl:rounded-3xl xl:shadow-card"
      >
        <div className="mb-3 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="truncate text-xl">{title}</h2>
            {d ? (
              <p className="text-sm text-muted">
                {d.category_name ?? 'Tanpa kategori'} ·{' '}
                {d.date_from === d.date_to ? d.date_from : `${d.date_from} – ${d.date_to}`}
              </p>
            ) : null}
          </div>
          <Button small aria-label="Tutup" onClick={onClose}>
            <X size={18} aria-hidden="true" />
            Tutup
          </Button>
        </div>
        {detail.error && !notFound ? (
          <ErrorState
            title="Detail produk belum bisa dimuat"
            onRetry={() => void detail.refetch()}
          />
        ) : null}
        {detail.isPending ? <Skeleton rows={4} /> : null}
        {d ? (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-2">
              <Stat
                label="Cup terjual"
                note={<Delta pct={d.compare_previous_period.items_sold_change_pct} vs={vsWord} />}
              >
                {cups.format(d.items_sold)} cup
              </Stat>
              <Stat
                label="Total Rp"
                note={<Delta pct={d.compare_previous_period.revenue_change_pct} vs={vsWord} />}
              >
                {formatRupiah(d.revenue)}
              </Stat>
              <Stat label="Harga rata-rata" note={`Harga katalog ${formatRupiah(d.catalog_price)}`}>
                {formatRupiah(d.average_price)}
              </Stat>
              <Stat label="Kontribusi" note={`Peringkat ${d.rank} dari ${d.product_count}`}>
                {oneDecimal.format(d.share_pct)}%
              </Stat>
            </div>

            <section aria-label="Tren cup">
              <div className="mb-2 flex items-center justify-between gap-2">
                <h3 className="text-base">Tren cup</h3>
                <div role="group" aria-label="Satuan waktu" className="flex gap-1">
                  {(['day', 'hour'] as const).map((g) => (
                    <button
                      key={g}
                      type="button"
                      aria-pressed={granularity === g}
                      disabled={g === 'hour' && days > 31}
                      onClick={() => setGranularity(g)}
                      className={`min-h-11 rounded-full px-3 text-sm font-extrabold disabled:opacity-50 ${granularity === g ? 'bg-pri text-on-danger' : 'bg-tint text-tint-ink'}`}
                    >
                      {g === 'day' ? 'Per hari' : 'Per jam'}
                    </button>
                  ))}
                </div>
              </div>
              {series.isPending ? <Skeleton rows={2} /> : null}
              {series.error ? (
                <ErrorState title="Tren belum bisa dimuat" onRetry={() => void series.refetch()} />
              ) : null}
              {series.data && series.data.data.length > 0 ? (
                <CupChart data={series.data.data} granularity={granularity} />
              ) : null}
            </section>

            <section aria-label="Tunai vs QRIS">
              <h3 className="mb-2 text-base">Tunai vs QRIS</h3>
              {cash && qris ? (
                <>
                  <p className="flex flex-col font-extrabold tabular-nums">
                    <span className="inline-flex items-center gap-1">
                      <Banknote size={18} aria-hidden="true" /> Tunai {cups.format(cash.items_sold)}{' '}
                      cup · {formatRupiah(cash.revenue)} ({oneDecimal.format(cash.share_pct)}%)
                    </span>
                    <span className="inline-flex items-center gap-1 text-ok">
                      <QrCode size={18} aria-hidden="true" /> QRIS {cups.format(qris.items_sold)}{' '}
                      cup · {formatRupiah(qris.revenue)} ({oneDecimal.format(qris.share_pct)}%)
                    </span>
                  </p>
                  <div
                    aria-hidden="true"
                    className="mt-2 flex h-3 overflow-hidden rounded-full bg-cash"
                  >
                    <div className="bg-cash" style={{ width: `${cash.share_pct}%` }} />
                    <div className="bg-ok" style={{ width: `${qris.share_pct}%` }} />
                  </div>
                </>
              ) : null}
            </section>

            {scope === 'all' && d.by_outlet.length > 0 ? (
              <BreakdownList
                title="Per cabang"
                rows={d.by_outlet.map((o) => ({
                  id: o.outlet_id,
                  name: o.outlet_name,
                  cups: o.items_sold,
                  revenue: o.revenue,
                }))}
              />
            ) : null}
            {d.by_employee.length > 0 ? (
              <BreakdownList
                title="Per kasir"
                rows={d.by_employee.map((e) => ({
                  id: e.employee_id,
                  name: scope === 'all' ? `${e.employee_name} · ${e.outlet_name}` : e.employee_name,
                  cups: e.items_sold,
                  revenue: e.revenue,
                }))}
              />
            ) : null}
          </div>
        ) : null}
      </aside>
    </>
  );
}

function BreakdownList({
  title,
  rows,
}: {
  title: string;
  rows: { id: string; name: string; cups: number; revenue: number }[];
}) {
  return (
    <section aria-label={title}>
      <h3 className="mb-2 text-base">{title}</h3>
      <ul>
        {rows.map((r) => (
          <li
            key={r.id}
            className="flex min-h-11 items-center justify-between gap-3 border-t border-line py-2"
          >
            <span className="min-w-0 truncate font-extrabold">{r.name}</span>
            <span className="shrink-0 text-right tabular-nums">
              {cups.format(r.cups)} cup
              <span className="block text-[13px] text-muted">{formatRupiah(r.revenue)}</span>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
