import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import type { Employee, Shift, ShiftSummary } from '@kelola-kasir/contracts';
import { formatRupiah } from '@kelola-kasir/money';
import { Link } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { DateRangePicker, initialRange } from '../components/DateRangePicker';
import {
  Alert,
  Badge,
  Button,
  Card,
  CheckboxField,
  Dialog,
  EmptyState,
  ErrorState,
  NoticeCard,
  PageHeader,
  SelectField,
  Skeleton,
} from '../components/ui';
import { api, qs } from '../lib/api';
import { formatTime, wibDate } from '../lib/dates';
import { errorMessage, formatDateTime } from '../lib/format';

type Page = { data: Shift[]; next_cursor: string | null };

/** Difference is conveyed by icon + sign + text, never by colour alone. */
export function Difference({ value }: { value: number | null | undefined }) {
  if (value == null) return <span className="text-muted">—</span>;
  if (value === 0) return <Badge tone="ok">Pas</Badge>;
  const short = value < 0;
  return (
    <span
      className={`inline-flex min-h-[26px] items-center rounded-full px-2.5 text-xs font-extrabold ${short ? 'bg-need-bg text-need-ink' : 'bg-warm-bg text-warm-ink'}`}
    >
      {short ? '▼ Kurang' : '▲ Lebih'} {formatRupiah(Math.abs(value))}
    </span>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-3 py-1">
      <dt className="text-muted">{label}</dt>
      <dd className="text-right font-semibold">{children}</dd>
    </div>
  );
}

function ShiftDialog({ shift, onClose }: { shift: Shift; onClose: () => void }) {
  const { data, error, isPending } = useQuery({
    queryKey: ['shift-summary', shift.id],
    queryFn: () => api<ShiftSummary>(`/shifts/${shift.id}/summary`),
  });
  return (
    <Dialog title={`Shift ${formatDateTime(shift.opened_at)}`} onClose={onClose}>
      {isPending ? <Skeleton rows={2} /> : null}
      {error ? <Alert>{errorMessage(error)}</Alert> : null}
      {data ? (
        <div className="text-sm">
          {shift.closed_offline ? (
            <Alert tone="warn">Shift ditutup saat offline dan disinkronkan belakangan.</Alert>
          ) : null}
          {data.unsynced_hint ? (
            <Alert tone="warn">
              Perangkat melaporkan data belum tersinkron saat shift ditutup.
            </Alert>
          ) : null}
          <dl>
            <Row label="Modal awal">{formatRupiah(shift.opening_cash)}</Row>
            <Row label="Penjualan cash">{formatRupiah(data.total_cash_sales)}</Row>
            <Row label="Penjualan QRIS (tidak masuk laci)">
              {formatRupiah(data.total_qris_sales)}
            </Row>
            <Row label="Seharusnya di laci">{formatRupiah(data.expected_cash)}</Row>
            <Row label="Aktual">
              {data.actual_cash == null ? '—' : formatRupiah(data.actual_cash)}
            </Row>
            <Row label="Selisih">
              <Difference value={data.cash_difference} />
            </Row>
            <Row label="Batal menunggu">
              {data.pending_void_count} ({formatRupiah(data.pending_void_amount)})
            </Row>
            <Row label="Batal disetujui">
              {data.voided_count} ({formatRupiah(data.voided_amount)})
            </Row>
            {data.deleted_count ? (
              <Row label="Transaksi dihapus">
                {data.deleted_count} transaksi dihapus ({formatRupiah(data.deleted_amount ?? 0)})
              </Row>
            ) : null}
            {data.late_transaction_count ? (
              <Row label="Transaksi sinkron terlambat">
                {data.late_transaction_count} ({formatRupiah(data.late_cash_amount ?? 0)} cash)
              </Row>
            ) : null}
          </dl>
          {data.by_employee?.length ? (
            <>
              <h3 className="mt-3 mb-1 text-base">Per kasir</h3>
              <ul>
                {data.by_employee.map((e) => (
                  <li key={e.employee.id} className="flex justify-between gap-3 py-1">
                    <span>
                      {e.employee.name} · {e.transaction_count} transaksi
                    </span>
                    <span>{formatRupiah(e.total_cash_sales + e.total_qris_sales)}</span>
                  </li>
                ))}
              </ul>
            </>
          ) : null}
          <Link
            to="/transaksi"
            search={{
              shift_id: shift.id,
              date_from: wibDate(new Date(shift.opened_at)),
              date_to: wibDate(shift.closed_at ? new Date(shift.closed_at) : new Date()),
            }}
            className="mt-3 inline-block text-tint-ink underline"
            onClick={onClose}
          >
            Lihat daftar transaksi
          </Link>
        </div>
      ) : null}
      <div className="mt-4">
        <Button onClick={onClose}>Tutup</Button>
      </div>
    </Dialog>
  );
}

export function ShiftsPage() {
  const [state, setState] = useState(initialRange);
  const [employeeId, setEmployeeId] = useState('');
  const [onlyDiff, setOnlyDiff] = useState(false);
  const [selected, setSelected] = useState<Shift | null>(null);
  const employees = useQuery({
    queryKey: ['employees'],
    queryFn: () => api<{ data: Employee[] }>('/employees'),
  });
  // Separate from the date-filtered list: a shift opened before `date_from` is still running.
  const openShifts = useQuery({
    queryKey: ['shifts', 'open'],
    queryFn: () => api<Page>(`/shifts${qs({ status: 'open', limit: 5 })}`),
  });
  const filters = { date_from: state.range.from, date_to: state.range.to, employee_id: employeeId };
  const list = useInfiniteQuery({
    queryKey: ['shifts', filters],
    initialPageParam: '',
    queryFn: ({ pageParam }) => api<Page>(`/shifts${qs({ ...filters, cursor: pageParam })}`),
    getNextPageParam: (last) => last.next_cursor ?? undefined,
  });
  const all = list.data?.pages.flatMap((p) => p.data) ?? [];
  // The filter only sees loaded pages, so while it is on, keep loading until
  // every page is in; otherwise older shifts with a difference stay hidden.
  const { hasNextPage, isFetchingNextPage, fetchNextPage, isError } = list;
  useEffect(() => {
    if (onlyDiff && hasNextPage && !isFetchingNextPage && !isError) void fetchNextPage();
  }, [onlyDiff, hasNextPage, isFetchingNextPage, isError, fetchNextPage]);
  const scanning = onlyDiff && !!hasNextPage && !isError;
  const running = openShifts.data?.data ?? [];
  const rows = onlyDiff ? all.filter((s) => (s.cash_difference ?? 0) !== 0) : all;

  return (
    <>
      <PageHeader title="Shift & Kas" />
      <p className="-mt-3 mb-4 text-sm font-bold text-muted">Kas awal, kas akhir, dan selisih</p>
      {running.map((r) => (
        <NoticeCard key={r.id}>
          <p>
            {r.opened_by.name} lagi jaga sejak {formatTime(r.opened_at)} · Kas awal{' '}
            {formatRupiah(r.opening_cash)}
          </p>
        </NoticeCard>
      ))}
      <Card className="mb-4">
        <DateRangePicker value={state} onChange={setState} />
        <div className="mt-3 grid gap-x-3 sm:grid-cols-2">
          <SelectField
            label="Pegawai"
            value={employeeId}
            onChange={(e) => setEmployeeId(e.target.value)}
          >
            <option value="">Semua pegawai</option>
            {employees.data?.data.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name}
              </option>
            ))}
          </SelectField>
          <CheckboxField
            label="Hanya yang selisih"
            checked={onlyDiff}
            onChange={(e) => setOnlyDiff(e.target.checked)}
          />
        </div>
      </Card>

      {list.isPending ? <Skeleton /> : null}
      {list.error ? (
        <ErrorState title="Waduh, data shift belum kebuka." onRetry={() => void list.refetch()}>
          Cek sinyal, lalu coba lagi ya.
        </ErrorState>
      ) : null}
      {scanning ? (
        <p role="status" className="mb-2 text-sm text-muted">
          Memeriksa semua shift untuk mencari selisih…
        </p>
      ) : null}
      {list.data && rows.length === 0 && !scanning ? (
        <Card>
          <EmptyState icon="💵" title="Belum ada shift di rentang ini." />
        </Card>
      ) : null}
      {rows.length > 0 ? (
        <ul className="space-y-2">
          {rows.map((s) => (
            <li key={s.id}>
              <button
                type="button"
                onClick={() => setSelected(s)}
                aria-label={`Detail shift ${formatDateTime(s.opened_at)}`}
                className="grid w-full grid-cols-2 gap-x-3 gap-y-1 rounded-[16px] bg-surface p-3 text-left shadow-card hover:bg-bg md:grid-cols-[1.4fr_1fr_1fr_1fr_1fr_1.2fr]"
              >
                <span className="col-span-2 font-bold md:col-span-1">
                  {formatDateTime(s.opened_at)}
                  <span className="block text-[13px] font-normal text-muted">
                    {s.opened_by.name}
                    {s.status === 'open' ? ' · ' : ''}
                    {s.status === 'open' ? <Badge tone="warn">Terbuka</Badge> : null}
                  </span>
                </span>
                <span className="text-[13px]">
                  <span className="block text-muted">Modal</span>
                  {formatRupiah(s.opening_cash)}
                </span>
                <span className="text-[13px]">
                  <span className="block text-muted">Seharusnya</span>
                  {s.expected_cash == null ? '—' : formatRupiah(s.expected_cash)}
                </span>
                <span className="text-[13px]">
                  <span className="block text-muted">Aktual</span>
                  {s.actual_cash == null ? '—' : formatRupiah(s.actual_cash)}
                </span>
                <span className="text-[13px] md:col-span-2">
                  <span className="block text-muted">Selisih</span>
                  <Difference value={s.cash_difference} />
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {list.hasNextPage && !onlyDiff ? (
        <div className="mt-3">
          <Button
            small
            disabled={list.isFetchingNextPage}
            onClick={() => void list.fetchNextPage()}
          >
            Muat lebih banyak
          </Button>
        </div>
      ) : null}
      {selected ? <ShiftDialog shift={selected} onClose={() => setSelected(null)} /> : null}
    </>
  );
}
