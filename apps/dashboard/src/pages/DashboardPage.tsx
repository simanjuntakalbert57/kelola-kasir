import { useQuery } from '@tanstack/react-query';
import type { components } from '@kelola-kasir/contracts';
import { formatRupiah } from '@kelola-kasir/money';
import { Link } from '@tanstack/react-router';
import { useState } from 'react';
import { DateRangePicker, initialRange } from '../components/DateRangePicker';
import { Alert, Card, EmptyState, PageHeader, Skeleton } from '../components/ui';
import { api, qs } from '../lib/api';
import { formatShortDate, formatTime } from '../lib/dates';

type Summary = components['schemas']['DashboardSummary'];
type Point = { bucket_start: string; revenue: number; transaction_count: number };
type Top = { product_id?: string | null; product_name: string; quantity: number; revenue: number };

function Kpi({ label, value, note }: { label: string; value: string; note?: string | undefined }) {
  return (
    <Card className="min-w-0">
      <p className="text-sm text-muted">{label}</p>
      <p className="mt-1 text-xl font-extrabold break-words md:text-2xl">{value}</p>
      {note ? <p className="mt-1 text-[13px] text-muted">{note}</p> : null}
    </Card>
  );
}

const pct = (part: number, total: number) => (total === 0 ? 0 : Math.round((part / total) * 100));

function SalesChart({ data, granularity }: { data: Point[]; granularity: 'hour' | 'day' }) {
  const max = Math.max(1, ...data.map((d) => d.revenue));
  const peak = data.reduce((best, d) => (d.revenue > best.revenue ? d : best));
  const label = (d: Point) =>
    granularity === 'hour'
      ? formatTime(d.bucket_start).slice(0, 2)
      : formatShortDate(d.bucket_start);
  return (
    <figure>
      <div
        role="img"
        aria-label={`Penjualan per ${granularity === 'hour' ? 'jam' : 'hari'}, puncak ${label(peak)} sebesar ${formatRupiah(peak.revenue)}`}
        className="flex h-40 items-end gap-1"
      >
        {data.map((d) => (
          <div
            key={d.bucket_start}
            title={`${label(d)}: ${formatRupiah(d.revenue)} (${d.transaction_count} transaksi)`}
            className={`min-w-1 flex-1 rounded-t-[4px] ${d === peak && d.revenue > 0 ? 'bg-accent' : 'bg-brand-600'}`}
            style={{ height: `${Math.max(2, (d.revenue / max) * 100)}%` }}
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
      {peak.revenue > 0 ? (
        <figcaption className="mt-2 text-sm text-muted">
          Puncak: {label(peak)} · {formatRupiah(peak.revenue)}
        </figcaption>
      ) : null}
    </figure>
  );
}

export function DashboardPage() {
  const [state, setState] = useState(initialRange);
  const { from, to } = state.range;
  const range = { date_from: from, date_to: to };
  const granularity = from === to ? 'hour' : 'day';

  const summary = useQuery({
    queryKey: ['dashboard', 'summary', from, to],
    queryFn: () => api<Summary>(`/dashboard/summary${qs(range)}`),
  });
  const series = useQuery({
    queryKey: ['dashboard', 'series', from, to, granularity],
    queryFn: () =>
      api<{ data: Point[] }>(`/dashboard/sales-series${qs({ ...range, granularity })}`),
  });
  const top = useQuery({
    queryKey: ['dashboard', 'top', from, to],
    queryFn: () => api<{ data: Top[] }>(`/dashboard/top-products${qs({ ...range, limit: 5 })}`),
  });
  const openShifts = useQuery({
    queryKey: ['shifts', 'open'],
    queryFn: () =>
      api<{ data: { id: string; opened_by: { name: string } }[] }>(
        `/shifts${qs({ status: 'open', limit: 5 })}`,
      ),
  });

  const s = summary.data;
  const open = openShifts.data?.data[0];
  const pending = s?.pending_void_count ?? 0;
  const change = s?.compare_previous_period?.revenue_change_pct;

  return (
    <>
      <PageHeader title="Dashboard" />
      <div className="mb-4">
        <DateRangePicker value={state} onChange={setState} />
      </div>

      {open || pending > 0 ? (
        <div className="mb-4 space-y-2">
          {open ? (
            <Alert tone="warn">
              Shift terbuka ({open.opened_by.name}).{' '}
              <Link to="/shift" className="underline">
                Lihat shift
              </Link>
            </Alert>
          ) : null}
          {pending > 0 ? (
            <Alert tone="warn">
              {pending} permintaan void menunggu persetujuan.{' '}
              <Link to="/void" className="underline">
                Tinjau
              </Link>
            </Alert>
          ) : null}
        </div>
      ) : null}

      {summary.error ? (
        <Alert>
          Gagal memuat ringkasan.{' '}
          <button type="button" className="underline" onClick={() => void summary.refetch()}>
            Coba lagi
          </button>
        </Alert>
      ) : null}
      {summary.isPending ? <Skeleton rows={2} /> : null}
      {s ? (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Kpi
            label="Omzet"
            value={formatRupiah(s.revenue)}
            note={
              typeof change === 'number'
                ? `${change >= 0 ? '▲' : '▼'} ${Math.abs(Math.round(change))}% vs periode lalu`
                : undefined
            }
          />
          <Kpi label="Transaksi" value={String(s.transaction_count)} />
          <Kpi label="Rata-rata" value={formatRupiah(s.average_ticket)} />
          <Kpi
            label="Cash / QRIS"
            value={`${pct(s.cash_revenue, s.revenue)}% / ${pct(s.qris_revenue, s.revenue)}%`}
            note={`${s.cash_count} cash · ${s.qris_count} QRIS`}
          />
        </div>
      ) : null}

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <h2 className="mb-3 text-lg">Penjualan per {granularity === 'hour' ? 'jam' : 'hari'}</h2>
          {series.isPending ? <Skeleton rows={2} /> : null}
          {series.error ? <Alert>Gagal memuat grafik.</Alert> : null}
          {series.data && series.data.data.length === 0 ? (
            <EmptyState icon="📊" title="Belum ada penjualan" />
          ) : null}
          {series.data && series.data.data.length > 0 ? (
            <SalesChart data={series.data.data} granularity={granularity} />
          ) : null}
        </Card>
        <Card>
          <h2 className="mb-3 text-lg">Terlaris</h2>
          {top.isPending ? <Skeleton rows={3} /> : null}
          {top.error ? <Alert>Gagal memuat produk terlaris.</Alert> : null}
          {top.data && top.data.data.length === 0 ? (
            <p className="text-sm text-muted">Belum ada produk terjual.</p>
          ) : null}
          {top.data && top.data.data.length > 0 ? (
            <ol className="space-y-2">
              {top.data.data.map((p, i) => (
                <li key={p.product_id ?? p.product_name} className="flex justify-between gap-3">
                  <span className="min-w-0 truncate">
                    {i + 1}. {p.product_name}
                  </span>
                  <span className="shrink-0 font-bold" title={formatRupiah(p.revenue)}>
                    {p.quantity}
                  </span>
                </li>
              ))}
            </ol>
          ) : null}
        </Card>
      </div>
    </>
  );
}
