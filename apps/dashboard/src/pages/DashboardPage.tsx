import { useQuery } from '@tanstack/react-query';
import type { components } from '@kelola-kasir/contracts';
import { formatRupiah } from '@kelola-kasir/money';
import { Link, useNavigate, useSearch } from '@tanstack/react-router';
import { useCallback, useRef, useState } from 'react';
import { Banknote, QrCode } from 'lucide-react';
import { DateRangePicker, initialRange } from '../components/DateRangePicker';
import { ProductDetailPanel, ProductSalesCard } from '../components/ProductSales';
import {
  Card,
  EmptyState,
  ErrorState,
  NoticeCard,
  PageHeader,
  Skeleton,
  Toast,
} from '../components/ui';
import { useAuth } from '../auth/AuthProvider';
import { useExpenseScope } from '../lib/expenses';
import { api, qs } from '../lib/api';
import { addDays, formatShortDate, formatTime } from '../lib/dates';
import {
  BUSY_SENTENCE,
  busyness,
  greeting,
  peakHourSentence,
  revenueBeforeHour,
  WIB_HOUR,
} from '../lib/insight';

type Summary = components['schemas']['DashboardSummary'];
type OutletBreakdown = Summary['by_outlet'][number];
type Point = { bucket_start: string; revenue: number; transaction_count: number };

function Kpi({ label, value, note }: { label: string; value: string; note?: string | undefined }) {
  return (
    <Card className="min-w-0">
      <p className="text-sm font-bold text-muted">{label}</p>
      <p className="mt-1 text-[26px] leading-8 font-extrabold tabular-nums break-words">{value}</p>
      {note ? <p className="mt-1 text-[13px] font-bold text-muted">{note}</p> : null}
    </Card>
  );
}

const cupFormat = new Intl.NumberFormat('id-ID');
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
            className={`min-w-1 flex-1 rounded-t-[4px] ${d === peak && d.revenue > 0 ? 'bg-pri' : 'bg-bar'}`}
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
    </figure>
  );
}

function PaymentSplit({ summary }: { summary: Summary }) {
  const cash = pct(summary.cash_revenue, summary.revenue);
  const qris = summary.revenue === 0 ? 0 : 100 - cash;
  return (
    <Card className="min-w-0">
      <p className="text-sm font-bold text-muted">Cara bayar</p>
      <p className="mt-1 flex flex-col gap-x-3 text-[17px] leading-7 font-extrabold tabular-nums">
        <span className="inline-flex items-center gap-1">
          <Banknote size={18} aria-hidden="true" className="shrink-0" /> Tunai{' '}
          {formatRupiah(summary.cash_revenue)} ({cash}%) · {summary.cash_count} trx
        </span>
        <span className="inline-flex items-center gap-1 text-ok">
          <QrCode size={18} aria-hidden="true" className="shrink-0" /> QRIS{' '}
          {formatRupiah(summary.qris_revenue)} ({qris}
          %) · {summary.qris_count} trx
        </span>
      </p>
      <div aria-hidden="true" className="mt-2 flex h-3 overflow-hidden rounded-full bg-cash">
        <div className="bg-cash" style={{ width: `${cash}%` }} />
        <div className="bg-ok" style={{ width: `${qris}%` }} />
      </div>
    </Card>
  );
}

function CupCard({ summary, vsWord }: { summary: Summary; vsWord: string }) {
  const change = summary.compare_previous_period?.items_sold_change_pct;
  return (
    <Card className="min-w-0">
      <p className="text-sm font-bold text-muted">Cup terjual</p>
      <p className="mt-1 text-[26px] leading-8 font-extrabold tabular-nums">
        {cupFormat.format(summary.items_sold ?? 0)} cup
      </p>
      {typeof change === 'number' ? (
        <p className="mt-1 text-[13px] font-bold text-muted">
          {change >= 0 ? '▲' : '▼'} {Math.abs(Math.round(change))}% {vsWord}
        </p>
      ) : null}
    </Card>
  );
}

function BranchBreakdown({ rows }: { rows: OutletBreakdown[] }) {
  return (
    <Card className="mt-3 min-w-0">
      <h2 className="mb-3 text-lg">Per cabang</h2>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[480px] text-left text-sm tabular-nums">
          <thead className="text-muted">
            <tr>
              <th scope="col" className="py-1 pr-3 font-bold">
                Cabang
              </th>
              <th scope="col" className="px-3 py-1 text-right font-bold">
                Omzet
              </th>
              <th scope="col" className="px-3 py-1 text-right font-bold">
                Tunai
              </th>
              <th scope="col" className="px-3 py-1 text-right font-bold">
                QRIS
              </th>
              <th scope="col" className="py-1 pl-3 text-right font-bold">
                Cup
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.outlet_id} className="border-t border-line">
                <th scope="row" className="py-2 pr-3 font-extrabold">
                  {r.outlet_name}
                </th>
                <td className="px-3 py-2 text-right">{formatRupiah(r.revenue)}</td>
                <td className="px-3 py-2 text-right">{formatRupiah(r.cash_revenue)}</td>
                <td className="px-3 py-2 text-right">{formatRupiah(r.qris_revenue)}</td>
                <td className="py-2 pl-3 text-right">{cupFormat.format(r.items_sold)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

export function DashboardPage() {
  const { scope, outletId, outletName } = useExpenseScope();
  const { user } = useAuth();
  const [state, setState] = useState(initialRange);
  const { from, to } = state.range;
  const range = { date_from: from, date_to: to };
  const granularity = from === to ? 'hour' : 'day';
  const isToday = state.preset === 'today';
  const navigate = useNavigate();
  const { produk } = useSearch({ strict: false }) as { produk?: string };
  const triggerRef = useRef<HTMLElement | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [openName, setOpenName] = useState<string | undefined>();
  const showToast = useCallback((m: string) => {
    setToast(m);
    setTimeout(() => setToast(null), 4000);
  }, []);
  const closeDetail = useCallback(() => {
    void navigate({ to: '/', search: {}, replace: true });
    triggerRef.current?.focus();
  }, [navigate]);
  const detailNotFound = useCallback(() => {
    showToast('Produk tidak ditemukan');
    void navigate({ to: '/', search: {}, replace: true });
  }, [navigate, showToast]);

  const summary = useQuery({
    queryKey: ['dashboard', 'summary', outletId, scope, from, to],
    queryFn: () => api<Summary>(`/dashboard/summary${qs({ ...range, outlet_scope: scope })}`),
  });
  const series = useQuery({
    queryKey: ['dashboard', 'series', from, to, granularity],
    queryFn: () =>
      api<{ data: Point[] }>(`/dashboard/sales-series${qs({ ...range, granularity })}`),
  });
  const openShifts = useQuery({
    queryKey: ['shifts', 'open'],
    queryFn: () =>
      api<{ data: { id: string; opened_at?: string; opened_by: { name: string } }[] }>(
        `/shifts${qs({ status: 'open', limit: 5 })}`,
      ),
  });
  // The seven days before today, hourly, feed the rame/sepi sentence (same hours as today so far);
  // only meaningful for "Hari ini".
  const week = useQuery({
    queryKey: ['dashboard', 'week', from],
    enabled: isToday && scope !== 'all',
    queryFn: () =>
      api<{ data: Point[] }>(
        `/dashboard/sales-series${qs({ date_from: addDays(from, -7), date_to: addDays(from, -1), granularity: 'hour' })}`,
      ),
  });

  const s = summary.data;
  const open = openShifts.data?.data[0];
  const pending = s?.pending_void_count ?? 0;
  const change = s?.compare_previous_period?.revenue_change_pct;
  const rangeWord = isToday ? 'hari ini' : state.preset === '7d' ? '7 hari ini' : 'periode ini';
  const mood =
    isToday && scope !== 'all' && s && week.data
      ? busyness(s.revenue, revenueBeforeHour(week.data.data, addDays(from, -7), 7, WIB_HOUR()))
      : null;
  const peak = series.data?.data.reduce<Point | null>(
    (best, d) => (d.revenue > (best?.revenue ?? 0) ? d : best),
    null,
  );
  const title = greeting(user?.name, WIB_HOUR());

  return (
    <div className="flex items-start gap-4">
      <div className="flex min-w-0 flex-1 flex-col">
        <PageHeader title={`${title}${user?.name ? ' 👋' : ''}`} />
        <div className="mb-4">
          <DateRangePicker value={state} onChange={setState} />
        </div>

        {pending > 0 ? (
          <div className="order-last md:order-first">
            <NoticeCard kind="action" title={`${pending} permintaan batal nunggu Bapak`}>
              <Link to="/void" className="underline">
                Tinjau
              </Link>
            </NoticeCard>
          </div>
        ) : null}
        {open ? (
          <NoticeCard>
            <p>
              {open.opened_by.name} lagi jaga kasir
              {open.opened_at ? ` sejak ${formatTime(open.opened_at)}` : ''}. Semua lancar.{' '}
              <Link to="/shift" className="underline">
                Lihat shift
              </Link>
            </p>
          </NoticeCard>
        ) : null}

        {summary.error ? (
          <ErrorState
            title="Waduh, ringkasannya belum kebuka."
            onRetry={() => void summary.refetch()}
          >
            Cek sinyal, lalu coba lagi ya.
          </ErrorState>
        ) : null}
        {summary.isPending ? <Skeleton rows={2} /> : null}
        {s ? (
          s.transaction_count === 0 ? (
            <Card>
              <EmptyState icon="🍹" title="Belum ada yang beli.">
                <p>{isToday ? 'Santai dulu, Pak. ' : ''}Nanti langsung muncul di sini.</p>
              </EmptyState>
            </Card>
          ) : (
            <>
              <section
                aria-label="Omzet"
                className="rounded-3xl bg-[image:var(--gradient-hero)] p-5 text-hero-ink shadow-card"
              >
                <p className="text-sm font-bold">Omzet {rangeWord}</p>
                <p className="mt-1 text-5xl leading-[52px] font-extrabold tracking-tight tabular-nums">
                  {formatRupiah(s.revenue)}
                </p>
                {typeof change === 'number' ? (
                  <p className="mt-2 text-sm font-bold">
                    {change >= 0 ? '▲' : '▼'} {Math.abs(Math.round(change))}%{' '}
                    {isToday ? 'dari kemarin' : 'dari periode lalu'}
                  </p>
                ) : null}
                <p className="mt-3 text-[15px] font-semibold">
                  {s.transaction_count} pesanan {rangeWord}.{mood ? ` ${BUSY_SENTENCE[mood]}` : ''}
                </p>
              </section>
              <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <CupCard summary={s} vsWord={isToday ? 'dari kemarin' : 'dari periode lalu'} />
                <Kpi label="Pesanan" value={String(s.transaction_count)} />
                <Kpi label="Rata-rata per pesanan" value={formatRupiah(s.average_ticket)} />
                <PaymentSplit summary={s} />
              </div>
            </>
          )
        ) : null}

        <ProductSalesCard
          period={range}
          scope={scope}
          selectedId={produk}
          onOpen={(id, el) => {
            triggerRef.current = el;
            setOpenName(el.querySelector('span.font-extrabold')?.textContent ?? undefined);
            void navigate({ to: '/', search: { produk: id } });
          }}
          onResetFilter={() => setState(initialRange())}
          onToast={showToast}
        />

        <div className="mt-4">
          <Card>
            <h2 className="mb-3 text-lg">
              Penjualan per {granularity === 'hour' ? 'jam' : 'hari'}
              {scope === 'all' ? ` · ${outletName}` : ''}
            </h2>
            {series.isPending ? <Skeleton rows={2} /> : null}
            {series.error ? (
              <ErrorState
                title="Waduh, grafiknya belum kebuka."
                onRetry={() => void series.refetch()}
              />
            ) : null}
            {series.data && series.data.data.length === 0 ? (
              <EmptyState icon="🍹" title="Belum ada yang beli." />
            ) : null}
            {series.data && series.data.data.length > 0 ? (
              <SalesChart data={series.data.data} granularity={granularity} />
            ) : null}
            {granularity === 'hour' && peak && peak.revenue > 0 ? (
              <p className="mt-1 text-sm font-bold text-muted">
                {peakHourSentence(Number(formatTime(peak.bucket_start).slice(0, 2)))}
              </p>
            ) : null}
          </Card>
        </div>
        {scope === 'all' && s?.by_outlet && s.by_outlet.length > 0 ? (
          <BranchBreakdown rows={s.by_outlet} />
        ) : null}
      </div>
      {produk ? (
        <ProductDetailPanel
          key={produk}
          productId={produk}
          name={openName}
          period={range}
          scope={scope}
          vsWord={isToday ? 'dari kemarin' : 'dari periode lalu'}
          onClose={closeDetail}
          onNotFound={detailNotFound}
        />
      ) : null}
      {toast ? <Toast>{toast}</Toast> : null}
    </div>
  );
}
