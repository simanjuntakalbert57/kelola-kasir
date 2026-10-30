import { useInfiniteQuery } from '@tanstack/react-query';
import type { DeletedTransactionSummary } from '@kelola-kasir/contracts';
import { formatRupiah } from '@kelola-kasir/money';
import { Link } from '@tanstack/react-router';
import { ArrowLeft } from 'lucide-react';
import { useState } from 'react';
import { DateRangePicker, type RangeState } from '../components/DateRangePicker';
import {
  Button,
  Card,
  EmptyState,
  ErrorState,
  Field,
  PageHeader,
  SelectField,
  Skeleton,
} from '../components/ui';
import { api, qs } from '../lib/api';
import { presetRange } from '../lib/dates';
import { useIsOwner } from '../lib/deletion';
import { formatDateTime } from '../lib/format';
import { METHOD_LABEL } from '../lib/labels';
import { useDebounced } from '../lib/useDebounced';
import { DetailDialog } from './TransactionsPage';

type Page = { data: DeletedTransactionSummary[]; next_cursor: string | null };
type DateField = 'deleted_at' | 'client_created_at';

export function DeletedTransactionsPage() {
  const isOwner = useIsOwner();
  const [state, setState] = useState<RangeState>({
    preset: '7d',
    range: presetRange('7d'),
  });
  const [dateField, setDateField] = useState<DateField>('deleted_at');
  const [search, setSearch] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  const q = useDebounced(search.trim());

  const list = useInfiniteQuery({
    queryKey: ['transactions-deleted', state.range.from, state.range.to, dateField, q],
    enabled: isOwner,
    initialPageParam: '',
    queryFn: ({ pageParam }) =>
      api<Page>(
        `/transactions/deleted${qs({
          date_from: state.range.from,
          date_to: state.range.to,
          date_field: dateField,
          q,
          cursor: pageParam,
        })}`,
      ),
    getNextPageParam: (last) => last.next_cursor ?? undefined,
  });
  const rows = list.data?.pages.flatMap((p) => p.data) ?? [];

  return (
    <>
      <PageHeader
        title="Riwayat Hapus"
        subtitle="Transaksi yang dihapus pemilik. Bisa dipulihkan kapan saja."
        action={
          <Link
            to="/transaksi"
            className="inline-flex min-h-11 items-center gap-2 text-sm font-extrabold text-pri underline"
          >
            <ArrowLeft size={18} aria-hidden="true" />
            Kembali ke Transaksi
          </Link>
        }
      />
      {!isOwner ? (
        <Card>
          <EmptyState icon="🔒" title="Riwayat Hapus hanya untuk pemilik.">
            <p>Masuk sebagai pemilik untuk melihat dan memulihkan transaksi.</p>
          </EmptyState>
        </Card>
      ) : (
        <>
          <Card className="mb-4">
            <DateRangePicker value={state} onChange={setState} />
            <div className="mt-3 grid gap-x-3 sm:grid-cols-2">
              <SelectField
                label="Filter tanggal berdasarkan"
                value={dateField}
                onChange={(e) => setDateField(e.target.value as DateField)}
              >
                <option value="deleted_at">Waktu hapus</option>
                <option value="client_created_at">Waktu transaksi</option>
              </SelectField>
              <Field
                label="Cari"
                placeholder="Nomor transaksi"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
          </Card>
          {list.isPending ? <Skeleton /> : null}
          {list.error ? (
            <ErrorState
              title="Waduh, Riwayat Hapus belum kebuka."
              onRetry={() => void list.refetch()}
            >
              Cek sinyal, lalu coba lagi ya.
            </ErrorState>
          ) : null}
          {list.data && rows.length === 0 ? (
            <Card>
              <EmptyState icon="🗑️" title="Belum ada transaksi yang dihapus.">
                <p>Coba ganti tanggal atau kata pencariannya ya.</p>
              </EmptyState>
            </Card>
          ) : null}
          {rows.length > 0 ? (
            <>
              <div className="hidden overflow-x-auto rounded-3xl bg-surface shadow-card md:block">
                <table className="w-full text-left text-sm">
                  <thead className="text-[13px] text-muted">
                    <tr>
                      {[
                        'Nomor',
                        'Tanggal transaksi',
                        'Total',
                        'Metode',
                        'Kasir',
                        'Dihapus oleh',
                        'Waktu hapus',
                        'Alasan',
                        '',
                      ].map((h) => (
                        <th key={h} scope="col" className="px-3 py-3 font-extrabold">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {rows.map((t) => (
                      <tr key={t.id}>
                        <td className="px-3 py-3 font-extrabold">{t.number}</td>
                        <td className="px-3 py-3">
                          {formatDateTime(t.paid_at ?? t.client_created_at)}
                        </td>
                        <td className="px-3 py-3 tabular-nums">{formatRupiah(t.total)}</td>
                        <td className="px-3 py-3">{METHOD_LABEL[t.payment_method]}</td>
                        <td className="px-3 py-3">{t.employee.name}</td>
                        <td className="px-3 py-3">{t.deleted.deleted_by.name}</td>
                        <td className="px-3 py-3">{formatDateTime(t.deleted.deleted_at)}</td>
                        <td className="max-w-[16rem] px-3 py-3">{t.deleted.reason}</td>
                        <td className="px-3 py-3">
                          <Button
                            small
                            aria-label={`Detail ${t.number}`}
                            onClick={() => setOpenId(t.id)}
                          >
                            Detail
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <ul className="space-y-2 md:hidden">
                {rows.map((t) => (
                  <li key={t.id}>
                    <button
                      type="button"
                      aria-label={`Detail ${t.number}`}
                      onClick={() => setOpenId(t.id)}
                      className="block min-h-16 w-full rounded-3xl bg-surface p-3 text-left shadow-card hover:bg-bg"
                    >
                      <span className="flex justify-between gap-3">
                        <span className="min-w-0 truncate font-extrabold">{t.number}</span>
                        <span className="shrink-0 font-extrabold tabular-nums">
                          {formatRupiah(t.total)}
                        </span>
                      </span>
                      <span className="block text-[13px] font-bold text-muted">
                        {METHOD_LABEL[t.payment_method]} · {t.employee.name}
                      </span>
                      <span className="block text-[13px] text-muted">
                        Dihapus {t.deleted.deleted_by.name} · {formatDateTime(t.deleted.deleted_at)}
                      </span>
                      <span className="block text-[13px]">“{t.deleted.reason}”</span>
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
                    Muat lagi
                  </Button>
                ) : null}
              </div>
            </>
          ) : null}
        </>
      )}
      {openId ? <DetailDialog id={openId} onClose={() => setOpenId(null)} /> : null}
    </>
  );
}
