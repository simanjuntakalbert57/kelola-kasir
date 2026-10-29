import { useInfiniteQuery, useMutation, useQuery } from '@tanstack/react-query';
import type { Employee, Transaction, TransactionSummary } from '@kelola-kasir/contracts';
import { formatRupiah } from '@kelola-kasir/money';
import { useSearch } from '@tanstack/react-router';
import { useState } from 'react';
import { DateRangePicker, initialRange, type RangeState } from '../components/DateRangePicker';
import {
  Alert,
  Badge,
  Button,
  Card,
  Dialog,
  EmptyState,
  Field,
  PageHeader,
  SelectField,
  Skeleton,
} from '../components/ui';
import { api, download, qs } from '../lib/api';
import { formatDateTime, errorMessage } from '../lib/format';
import { METHOD_LABEL, STATUS_LABEL } from '../lib/labels';
import { useDebounced } from '../lib/useDebounced';

type Page = { data: TransactionSummary[]; next_cursor: string | null };

function StatusBadge({ status }: { status: TransactionSummary['status'] }) {
  const s = STATUS_LABEL[status];
  return <Badge tone={s.tone}>{s.label}</Badge>;
}

function DetailDialog({ id, onClose }: { id: string; onClose: () => void }) {
  const { data, error, isPending } = useQuery({
    queryKey: ['transaction', id],
    queryFn: () => api<Transaction>(`/transactions/${id}`),
  });
  return (
    <Dialog title={data ? `Transaksi ${data.number}` : 'Detail transaksi'} onClose={onClose}>
      {isPending ? <Skeleton rows={2} /> : null}
      {error ? <Alert>{errorMessage(error)}</Alert> : null}
      {data ? (
        <div className="text-sm">
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
            <p className="mt-2 text-muted">Void: “{data.void_request.reason}”</p>
          ) : null}
        </div>
      ) : null}
      <Button className="mt-4" onClick={onClose}>
        Tutup
      </Button>
    </Dialog>
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
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          className="size-5 accent-pri"
          checked={detail}
          onChange={(e) => setDetail(e.target.checked)}
        />
        Per item
      </label>
      <Button small disabled={exp.isPending} onClick={() => exp.mutate('csv')}>
        ⬇ CSV
      </Button>
      <Button small disabled={exp.isPending} onClick={() => exp.mutate('xlsx')}>
        ⬇ Excel
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
  const filtered = Boolean(shiftId || employeeId || method || status || q);
  const reset = () => {
    setShiftId('');
    setEmployeeId('');
    setMethod('');
    setStatus('');
    setSearch('');
  };

  return (
    <>
      <PageHeader
        title="Transaksi"
        action={shiftId ? null : <ExportButtons query={qs(filters)} />}
      />
      <Card className="mb-4">
        {shiftId ? (
          <p className="mb-2 flex items-center gap-2 text-sm">
            <Badge tone="ok">Filter: satu shift</Badge>
            <Button small onClick={() => setShiftId('')}>
              Hapus filter shift
            </Button>
            <span className="text-muted">Ekspor dinonaktifkan selama filter shift aktif.</span>
          </p>
        ) : null}
        <DateRangePicker value={state} onChange={setState} />
        <div className="mt-3 grid gap-x-3 sm:grid-cols-2 lg:grid-cols-4">
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
            <option value="cash">Cash</option>
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
          <Field
            label="Cari"
            placeholder="No. transaksi / pembeli"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </Card>

      {list.isPending ? <Skeleton /> : null}
      {list.error ? (
        <Alert>
          Gagal memuat transaksi.{' '}
          <button type="button" className="underline" onClick={() => void list.refetch()}>
            Coba lagi
          </button>
        </Alert>
      ) : null}
      {list.data && rows.length === 0 ? (
        <Card>
          <EmptyState icon="🧾" title="Tidak ada transaksi untuk filter ini">
            {filtered ? (
              <Button small onClick={reset}>
                Reset filter
              </Button>
            ) : null}
          </EmptyState>
        </Card>
      ) : null}
      {rows.length > 0 ? (
        <>
          <ul className="space-y-2">
            {rows.map((t) => (
              <li key={t.id}>
                <button
                  type="button"
                  onClick={() => setOpenId(t.id)}
                  aria-label={`Detail ${t.number}`}
                  className="grid w-full grid-cols-[1fr_auto] items-center gap-x-3 gap-y-1 rounded-[16px] bg-surface p-3 text-left shadow-card hover:bg-bg md:grid-cols-[1.5fr_1fr_1fr_1fr_8rem]"
                >
                  <span className="min-w-0 truncate font-bold">{t.number}</span>
                  <span className="text-right font-bold md:order-4 md:text-right">
                    {formatRupiah(t.total)}
                  </span>
                  <span className="text-[13px] text-muted">
                    {formatDateTime(t.paid_at ?? t.client_created_at)}
                  </span>
                  <span className="text-[13px] text-muted md:order-3">
                    {t.employee.name} · {METHOD_LABEL[t.payment_method]}
                  </span>
                  <span className="justify-self-end md:order-5">
                    <StatusBadge status={t.status} />
                  </span>
                </button>
              </li>
            ))}
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
        </>
      ) : null}
      {openId ? <DetailDialog id={openId} onClose={() => setOpenId(null)} /> : null}
    </>
  );
}
