import { useInfiniteQuery, useMutation, useQuery } from '@tanstack/react-query';
import type { Employee, Transaction, TransactionSummary } from '@kelola-kasir/contracts';
import { formatRupiah } from '@kelola-kasir/money';
import { Link, useSearch } from '@tanstack/react-router';
import {
  Archive,
  Banknote,
  ChevronRight,
  Download,
  QrCode,
  SlidersHorizontal,
  X,
} from 'lucide-react';
import { useState } from 'react';
import { DateRangePicker, initialRange, type RangeState } from '../components/DateRangePicker';
import {
  Alert,
  Badge,
  Button,
  Card,
  Dialog,
  EmptyState,
  ErrorState,
  Field,
  PageHeader,
  SelectField,
  Skeleton,
} from '../components/ui';
import { api, download, qs } from '../lib/api';
import { formatDateTime, errorMessage } from '../lib/format';
import { METHOD_LABEL, STATUS_LABEL } from '../lib/labels';
import { useDebounced } from '../lib/useDebounced';
import { useIsDesktop } from '../lib/useMediaQuery';
import { formatShortDate, formatTime, wibDate } from '../lib/dates';
import {
  DeleteTransactionButton,
  DeletionTimeline,
  RestoreTransactionButton,
} from '../components/DeleteTransaction';
import { useIsOwner } from '../lib/deletion';

type Page = { data: TransactionSummary[]; next_cursor: string | null };

function StatusBadge({ status }: { status: TransactionSummary['status'] }) {
  const s = STATUS_LABEL[status];
  return <Badge tone={s.tone}>{s.label}</Badge>;
}

export function DetailBody({ id }: { id: string }) {
  const { data, error, isPending } = useQuery({
    queryKey: ['transaction', id],
    queryFn: () => api<Transaction>(`/transactions/${id}`),
  });
  return (
    <>
      {isPending ? <Skeleton rows={2} /> : null}
      {error ? <Alert>{errorMessage(error)}</Alert> : null}
      {data ? (
        <div className="text-sm">
          {data.deleted ? (
            <Alert tone="warn">
              Dihapus oleh {data.deleted.deleted_by.name} ·{' '}
              {formatDateTime(data.deleted.deleted_at)} · “{data.deleted.reason}”
            </Alert>
          ) : null}
          <p className="mb-2 flex flex-wrap items-center gap-2">
            <StatusBadge status={data.status} />
            <span className="text-muted">
              {METHOD_LABEL[data.payment_method]} · {data.employee.name} ·{' '}
              {formatDateTime(data.paid_at ?? data.client_created_at)}
            </span>
          </p>
          {data.price_mismatch ? (
            <Alert tone="warn">Harga berbeda dari katalog saat ini.</Alert>
          ) : null}
          {data.after_shift_close ? (
            <Alert tone="warn">Disinkronkan setelah shift ditutup.</Alert>
          ) : null}
          <ul className="divide-y divide-line">
            {data.items.map((i) => (
              <li key={i.id} className="flex justify-between gap-3 py-2">
                <span className="min-w-0">
                  {i.quantity}× {i.product_name}
                  {i.note ? <span className="block text-[13px] text-muted">{i.note}</span> : null}
                </span>
                <span className="shrink-0">{formatRupiah(i.line_total)}</span>
              </li>
            ))}
          </ul>
          <p className="mt-2 flex justify-between font-extrabold">
            <span>Total</span>
            <span>{formatRupiah(data.total)}</span>
          </p>
          {data.payments.map((p) =>
            p.cash_tendered != null ? (
              <p key={p.id} className="mt-1 text-muted">
                Tunai {formatRupiah(p.cash_tendered)} · kembalian {formatRupiah(p.cash_change ?? 0)}
              </p>
            ) : null,
          )}
          {data.void_request ? (
            <p className="mt-2 text-muted">Alasan batal: “{data.void_request.reason}”</p>
          ) : null}
          {data.deletion_history ? <DeletionTimeline events={data.deletion_history} /> : null}
          {data.deleted ? (
            <RestoreTransactionButton tx={data} />
          ) : (
            <DeleteTransactionButton tx={data} />
          )}
        </div>
      ) : null}
    </>
  );
}

/** Transaction number moves from the list row into the detail heading. */
function useNumber(id: string): string | undefined {
  return useQuery({
    queryKey: ['transaction', id],
    queryFn: () => api<Transaction>(`/transactions/${id}`),
  }).data?.number;
}

export function DetailDialog({ id, onClose }: { id: string; onClose: () => void }) {
  const number = useNumber(id);
  return (
    <Dialog title={number ? `Transaksi ${number}` : 'Detail transaksi'} onClose={onClose}>
      <DetailBody id={id} />
      <Button className="mt-4" onClick={onClose}>
        Tutup
      </Button>
    </Dialog>
  );
}

/** Desktop detail panel beside the list. */
function DetailPanel({ id, onClose }: { id: string; onClose: () => void }) {
  const number = useNumber(id);
  return (
    <aside aria-label="Detail transaksi" className="sticky top-6 self-start">
      <Card>
        <div className="mb-3 flex items-center justify-between gap-2">
          <h2 className="min-w-0 truncate text-lg">
            {number ? `Transaksi ${number}` : 'Detail transaksi'}
          </h2>
          <button
            type="button"
            aria-label="Tutup detail"
            onClick={onClose}
            className="grid size-11 shrink-0 place-items-center rounded-2xl text-muted hover:bg-bg"
          >
            <X size={20} aria-hidden="true" />
          </button>
        </div>
        <DetailBody id={id} />
      </Card>
    </aside>
  );
}

function ExportButtons({ query }: { query: string }) {
  const [detail, setDetail] = useState(false);
  const exp = useMutation({
    mutationFn: async (format: 'csv' | 'xlsx') => {
      const sep = query ? '&' : '?';
      const { blob, filename } = await download(
        `/transactions/export${query}${sep}format=${format}${detail ? '&detail=true' : ''}`,
      );
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename.includes('.') ? filename : `${filename}.${format}`;
      a.click();
      URL.revokeObjectURL(url);
    },
  });
  return (
    <div className="flex flex-wrap items-center gap-2">
      <label className="flex min-h-11 items-center gap-2 text-sm font-bold">
        <input
          type="checkbox"
          className="size-5 accent-pri"
          checked={detail}
          onChange={(e) => setDetail(e.target.checked)}
        />
        Per item
      </label>
      <Button small disabled={exp.isPending} onClick={() => exp.mutate('csv')}>
        <Download size={18} aria-hidden="true" />
        Ekspor CSV
      </Button>
      <Button small disabled={exp.isPending} onClick={() => exp.mutate('xlsx')}>
        <Download size={18} aria-hidden="true" />
        Ekspor Excel
      </Button>
      {exp.error ? <span className="text-sm text-danger">{errorMessage(exp.error)}</span> : null}
    </div>
  );
}

export function TransactionsPage() {
  const {
    shift_id: initialShiftId,
    date_from,
    date_to,
  } = useSearch({ strict: false }) as {
    shift_id?: string;
    date_from?: string;
    date_to?: string;
  };
  const [shiftId, setShiftId] = useState(initialShiftId ?? '');
  const [state, setState] = useState<RangeState>(() =>
    date_from && date_to
      ? { preset: 'custom', range: { from: date_from, to: date_to } }
      : initialRange(),
  );
  const [employeeId, setEmployeeId] = useState('');
  const [method, setMethod] = useState('');
  const [status, setStatus] = useState('');
  const [search, setSearch] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  const q = useDebounced(search.trim());
  const isOwner = useIsOwner();

  const employees = useQuery({
    queryKey: ['employees'],
    queryFn: () => api<{ data: Employee[] }>('/employees'),
  });
  const filters = {
    date_from: state.range.from,
    date_to: state.range.to,
    employee_id: employeeId,
    shift_id: shiftId,
    payment_method: method,
    status,
  };
  const list = useInfiniteQuery({
    queryKey: ['transactions', filters, q],
    initialPageParam: '',
    queryFn: ({ pageParam }) =>
      api<Page>(`/transactions${qs({ ...filters, q, cursor: pageParam })}`),
    getNextPageParam: (last) => last.next_cursor ?? undefined,
  });
  const rows = list.data?.pages.flatMap((p) => p.data) ?? [];
  const multiDay = state.range.from !== state.range.to;
  const singleToday = !multiDay && state.range.from === wibDate();
  const filtered = Boolean(shiftId || employeeId || method || status || q);
  const reset = () => {
    setShiftId('');
    setEmployeeId('');
    setMethod('');
    setStatus('');
    setSearch('');
  };

  const desktop = useIsDesktop();
  const [sheet, setSheet] = useState(false);
  const activeFilters = [employeeId, method, status].filter(Boolean).length;

  const filterFields = (
    <>
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
      <SelectField label="Metode" value={method} onChange={(e) => setMethod(e.target.value)}>
        <option value="">Semua metode</option>
        <option value="cash">Tunai</option>
        <option value="qris">QRIS</option>
      </SelectField>
      <SelectField label="Status" value={status} onChange={(e) => setStatus(e.target.value)}>
        <option value="">Semua status</option>
        {Object.entries(STATUS_LABEL).map(([k, v]) => (
          <option key={k} value={k}>
            {v.label}
          </option>
        ))}
      </SelectField>
    </>
  );
  const searchField = (
    <Field
      label="Cari"
      placeholder="Nomor atau pegawai"
      value={search}
      onChange={(e) => setSearch(e.target.value)}
    />
  );

  return (
    <>
      <PageHeader
        title="Transaksi"
        action={shiftId ? null : <ExportButtons query={qs(filters)} />}
      />
      {isOwner ? (
        <p className="-mt-2 mb-3">
          <Link
            to="/transaksi/dihapus"
            className="inline-flex min-h-11 items-center gap-2 text-sm font-extrabold text-pri underline"
          >
            <Archive size={18} aria-hidden="true" />
            Riwayat Hapus
          </Link>
        </p>
      ) : null}
      {list.data ? (
        <p className="-mt-3 mb-4 text-sm font-bold text-muted">
          {rows.length}
          {list.hasNextPage ? '+' : ''} transaksi {singleToday ? 'hari ini' : 'di rentang ini'}
        </p>
      ) : null}
      {shiftId ? (
        <p className="mb-3 flex flex-wrap items-center gap-2 text-sm">
          <Badge tone="ok">Filter: satu shift</Badge>
          <Button small onClick={() => setShiftId('')}>
            Hapus filter shift
          </Button>
          <span className="text-muted">Ekspor dinonaktifkan selama filter shift aktif.</span>
        </p>
      ) : null}
      <Card className="mb-4">
        <DateRangePicker value={state} onChange={setState} />
        {desktop ? (
          <div className="mt-3 grid gap-x-3 sm:grid-cols-2 lg:grid-cols-4">
            {filterFields}
            {searchField}
          </div>
        ) : (
          <div className="mt-3 flex items-end gap-2">
            <div className="min-w-0 flex-1 [&>div]:mb-0">{searchField}</div>
            <Button className="shrink-0" onClick={() => setSheet(true)}>
              <SlidersHorizontal size={18} aria-hidden="true" />
              Filter{activeFilters ? ` (${activeFilters})` : ''}
            </Button>
          </div>
        )}
      </Card>
      {sheet && !desktop ? (
        <Dialog title="Filter transaksi" onClose={() => setSheet(false)}>
          {filterFields}
          <div className="mt-2 flex gap-2">
            <Button variant="primary" className="flex-1" onClick={() => setSheet(false)}>
              Terapkan
            </Button>
            <Button
              onClick={() => {
                setEmployeeId('');
                setMethod('');
                setStatus('');
              }}
            >
              Reset
            </Button>
          </div>
        </Dialog>
      ) : null}

      {list.isPending ? <Skeleton /> : null}
      {list.error ? (
        <ErrorState
          title="Waduh, daftar transaksinya belum kebuka."
          onRetry={() => void list.refetch()}
        >
          Cek sinyal, lalu coba lagi ya.
        </ErrorState>
      ) : null}
      {list.data && rows.length === 0 ? (
        <Card>
          <EmptyState icon="🧾" title="Belum ada transaksi di rentang ini.">
            <p>Coba ganti tanggalnya ya.</p>
            {filtered ? (
              <Button small onClick={reset}>
                Reset filter
              </Button>
            ) : null}
          </EmptyState>
        </Card>
      ) : null}
      {rows.length > 0 ? (
        <div className={desktop && openId ? 'grid grid-cols-[1fr_380px] items-start gap-4' : ''}>
          <div className="min-w-0">
            <ul className="space-y-2">
              {rows.map((t) => {
                const Icon = t.payment_method === 'qris' ? QrCode : Banknote;
                return (
                  <li key={t.id}>
                    <button
                      type="button"
                      onClick={() => setOpenId(t.id)}
                      aria-label={`Detail ${t.number}`}
                      aria-current={openId === t.id ? 'true' : undefined}
                      className={`flex min-h-16 w-full items-center gap-3 rounded-3xl p-3 text-left shadow-card hover:bg-bg ${openId === t.id ? 'bg-tint' : 'bg-surface'}`}
                    >
                      <span
                        aria-hidden="true"
                        className="grid size-[46px] shrink-0 place-items-center rounded-[14px] bg-tint text-tint-ink"
                      >
                        <Icon size={22} />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[15.5px] font-extrabold">
                          {t.employee.name} ·{' '}
                          {multiDay ? `${formatShortDate(t.paid_at ?? t.client_created_at)} ` : ''}
                          {formatTime(t.paid_at ?? t.client_created_at)}
                        </span>
                        <span className="block text-[13px] font-bold text-muted">
                          {t.item_count ? `${t.item_count} item · ` : ''}
                          {METHOD_LABEL[t.payment_method]}
                        </span>
                      </span>
                      <span className="flex shrink-0 flex-col items-end gap-1">
                        <span className="font-extrabold tabular-nums">{formatRupiah(t.total)}</span>
                        <StatusBadge status={t.status} />
                      </span>
                      <ChevronRight
                        size={18}
                        aria-hidden="true"
                        className="shrink-0 text-muted md:hidden"
                      />
                    </button>
                  </li>
                );
              })}
            </ul>
            <div className="mt-3 flex items-center justify-between text-sm text-muted">
              <span>Menampilkan {rows.length} transaksi</span>
              {list.hasNextPage ? (
                <Button
                  small
                  disabled={list.isFetchingNextPage}
                  onClick={() => void list.fetchNextPage()}
                >
                  Muat lebih banyak
                </Button>
              ) : null}
            </div>
          </div>
          {desktop && openId ? <DetailPanel id={openId} onClose={() => setOpenId(null)} /> : null}
        </div>
      ) : null}
      {openId && !desktop ? <DetailDialog id={openId} onClose={() => setOpenId(null)} /> : null}
    </>
  );
}
