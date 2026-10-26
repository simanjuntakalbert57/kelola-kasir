import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import type { Employee, Shift, ShiftSummary } from '@kelola-kasir/contracts';
import { formatRupiah } from '@kelola-kasir/money';
import { Link } from '@tanstack/react-router';
import { useState } from 'react';
import { DateRangePicker, initialRange } from '../components/DateRangePicker';
import {
  Alert,
  Badge,
  Button,
  Card,
  CheckboxField,
  Dialog,
  EmptyState,
  PageHeader,
  SelectField,
  Skeleton,
} from '../components/ui';
import { api, qs } from '../lib/api';
import { errorMessage, formatDateTime } from '../lib/format';

type Page = { data: Shift[]; next_cursor: string | null };

/** Difference is conveyed by sign + icon + text, never by colour alone. */
export function Difference({ value }: { value: number | null | undefined }) {
  if (value == null) return <span className="text-muted">—</span>;
  if (value === 0) return <b className="text-brand-text">0 ✓ Pas</b>;
  const short = value < 0;
  const text = `${short ? '−' : '+'}${formatRupiah(Math.abs(value))}`;
  return (
    <b className={short ? 'text-danger' : 'text-warn'}>
      {text} {short ? '▼ Kurang' : '▲ Lebih'}
    </b>
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
            <Row label="Void menunggu">
              {data.pending_void_count} ({formatRupiah(data.pending_void_amount)})
            </Row>
            <Row label="Void disetujui">
              {data.voided_count} ({formatRupiah(data.voided_amount)})
            </Row>
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
            className="mt-3 inline-block text-brand-text underline"
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
  const filters = { date_from: state.range.from, date_to: state.range.to, employee_id: employeeId };
  const list = useInfiniteQuery({
    queryKey: ['shifts', filters],
    initialPageParam: '',
    queryFn: ({ pageParam }) => api<Page>(`/shifts${qs({ ...filters, cursor: pageParam })}`),
    getNextPageParam: (last) => last.next_cursor ?? undefined,
  });
  const all = list.data?.pages.flatMap((p) => p.data) ?? [];
  const rows = onlyDiff ? all.filter((s) => (s.cash_difference ?? 0) !== 0) : all;

  return (
    <>
      <PageHeader title="Shift & rekonsiliasi kas" />
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
        <Alert>
          Gagal memuat shift.{' '}
          <button type="button" className="underline" onClick={() => void list.refetch()}>
            Coba lagi
          </button>
        </Alert>
      ) : null}
      {list.data && rows.length === 0 ? (
        <Card>
          <EmptyState icon="💵" title="Tidak ada shift untuk filter ini" />
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
                className="grid w-full grid-cols-2 gap-x-3 gap-y-1 rounded-[16px] bg-surface p-3 text-left shadow-card hover:bg-brand-50 md:grid-cols-[1.4fr_1fr_1fr_1fr_1fr_1.2fr]"
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
      {list.hasNextPage ? (
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
