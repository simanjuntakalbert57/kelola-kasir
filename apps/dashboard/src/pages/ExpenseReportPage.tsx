import { useQuery } from '@tanstack/react-query';
import {
  EXPENSE_FUNDING_SOURCE_LABELS,
  EXPENSE_GROUPS,
  EXPENSE_GROUP_LABELS,
  type ExpenseReport,
  type ExpenseReportCell,
} from '@kelola-kasir/contracts';
import { formatRupiah } from '@kelola-kasir/money';
import { ChevronLeft, ChevronRight, Info, TrendingDown, TrendingUp } from 'lucide-react';
import { useState } from 'react';
import { ExpenseTabs } from '../components/ExpenseTabs';
import {
  Card,
  CheckboxField,
  EmptyState,
  ErrorState,
  PageHeader,
  Skeleton,
} from '../components/ui';
import { api, qs } from '../lib/api';
import { wibDate } from '../lib/dates';
import { expenseKey, formatDate, formatMonth, shiftMonth, useExpenseScope } from '../lib/expenses';

type Counted = { outletName: string; countedFrom: string | null; beforeStart: boolean };

/** "Dihitung mulai 3 Nov 2026" / "belum beroperasi" for a cell the API counted only partly (DEAR-140). */
export function countedNote(c: Counted): string | null {
  if (!c.countedFrom) return null;
  return c.beforeStart
    ? `${c.outletName} mulai dihitung ${formatDate(c.countedFrom)}. Belum ada data di bulan ini sebelum tanggal itu.`
    : `${c.outletName ? `${c.outletName}: d` : 'D'}ihitung mulai ${formatDate(c.countedFrom)}`;
}

function Profit({ value }: { value: number }) {
  const loss = value < 0;
  const Icon = loss ? TrendingDown : TrendingUp;
  return (
    <div
      className={`rounded-3xl p-4 shadow-card ${loss ? 'border-2 border-danger bg-surface' : 'bg-ok-bg text-ok-ink'}`}
    >
      <p className="flex items-center gap-1.5 text-sm font-extrabold">
        <Icon size={18} aria-hidden="true" className={loss ? 'text-danger' : ''} />
        {loss ? 'Rugi sederhana' : 'Laba sederhana'}
      </p>
      <p className={`text-2xl font-extrabold tabular-nums ${loss ? 'text-danger' : ''}`}>
        {loss ? '▼ −' : ''}
        {formatRupiah(Math.abs(value))}
      </p>
      <p className="text-[13px] font-bold">Omzet dikurangi pengeluaran. Bukan laporan pajak.</p>
    </div>
  );
}

function Summary({ cell }: { cell: ExpenseReportCell }) {
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      <div className="rounded-3xl bg-surface p-4 shadow-card">
        <p className="text-sm font-extrabold text-muted">Omzet</p>
        <p className="text-2xl font-extrabold tabular-nums">{formatRupiah(cell.revenue)}</p>
        <p className="text-[13px] text-muted">
          Lunas + menunggu persetujuan batal · {cell.transaction_count} transaksi
        </p>
      </div>
      <div className="rounded-3xl bg-surface p-4 shadow-card">
        <p className="text-sm font-extrabold text-muted">Pengeluaran</p>
        <p className="text-2xl font-extrabold tabular-nums">{formatRupiah(cell.expense_total)}</p>
        <p className="text-[13px] text-muted">{cell.expense_count} catatan</p>
      </div>
      <Profit value={cell.profit} />
    </div>
  );
}

function Breakdown({ cell }: { cell: ExpenseReportCell }) {
  const total = cell.expense_total;
  return (
    <Card className="mt-4">
      <h2 className="mb-2 text-base">Pengeluaran per kategori</h2>
      {total === 0 ? (
        <p className="text-sm text-muted">Belum ada pengeluaran bulan ini.</p>
      ) : (
        EXPENSE_GROUPS.filter((g) => cell.by_group[g] > 0).map((g) => (
          <div key={g} className="mb-3">
            <p className="flex justify-between text-sm font-extrabold">
              <span>{EXPENSE_GROUP_LABELS[g]}</span>
              <span className="tabular-nums">{formatRupiah(cell.by_group[g])}</span>
            </p>
            <ul className="mt-1 space-y-1">
              {cell.by_category
                .filter((c) => c.group === g)
                .map((c) => (
                  <li key={`${c.category_id ?? ''}${c.name}`} className="text-sm">
                    <span className="flex justify-between">
                      <span>
                        {c.name} <small className="text-muted">({c.count})</small>
                      </span>
                      <span className="tabular-nums">{formatRupiah(c.amount)}</span>
                    </span>
                    <span aria-hidden="true" className="block h-1.5 rounded-full bg-tint">
                      <span
                        className="block h-1.5 rounded-full bg-pri"
                        style={{ width: `${Math.max(2, Math.round((c.amount / total) * 100))}%` }}
                      />
                    </span>
                  </li>
                ))}
            </ul>
          </div>
        ))
      )}
      <p className="mt-2 text-[13px] text-muted">
        Sumber dana: {EXPENSE_FUNDING_SOURCE_LABELS.drawer}{' '}
        {formatRupiah(cell.by_funding_source.drawer)} · {EXPENSE_FUNDING_SOURCE_LABELS.owner}{' '}
        {formatRupiah(cell.by_funding_source.owner)}
      </p>
    </Card>
  );
}

export function ExpenseReportPage() {
  const { scope, outletId, outletName, viewAll } = useExpenseScope();
  const [month, setMonth] = useState(() => wibDate().slice(0, 7));
  const [preOps, setPreOps] = useState(false);
  const thisMonth = wibDate().slice(0, 7);

  const report = useQuery({
    queryKey: expenseKey('report', outletId, scope, month, preOps),
    queryFn: () =>
      api<ExpenseReport>(
        `/reports/expenses${qs({
          month_from: month,
          month_to: month,
          outlet_scope: scope,
          include_pre_operations: preOps || undefined,
        })}`,
      ),
  });
  const cell = report.data?.months[0];
  const outlets = report.data?.outlets ?? [];
  const notes = (cell?.per_outlet ?? [])
    .map((c) => {
      const o = outlets.find((x) => x.id === c.outlet_id);
      return countedNote({
        outletName: viewAll ? (o?.name ?? '') : '',
        countedFrom: c.counted_from,
        beforeStart: Boolean(c.counted_from && c.counted_from.slice(0, 7) > month),
      });
    })
    .filter((n): n is string => n !== null);

  return (
    <>
      <PageHeader title="Rekap bulanan" subtitle={viewAll ? 'Semua cabang' : outletName} />
      <ExpenseTabs />
      <Card className="mb-4">
        <div className="flex items-center justify-between gap-2">
          <button
            type="button"
            aria-label="Bulan sebelumnya"
            onClick={() => setMonth(shiftMonth(month, -1))}
            className="grid size-11 place-items-center rounded-2xl hover:bg-bg"
          >
            <ChevronLeft size={22} aria-hidden="true" />
          </button>
          <b className="text-lg font-extrabold" aria-live="polite">
            {formatMonth(month)}
          </b>
          <button
            type="button"
            aria-label="Bulan berikutnya"
            disabled={month >= thisMonth}
            onClick={() => setMonth(shiftMonth(month, 1))}
            className="grid size-11 place-items-center rounded-2xl hover:bg-bg disabled:opacity-40"
          >
            <ChevronRight size={22} aria-hidden="true" />
          </button>
        </div>
        <CheckboxField
          label="Termasuk masa uji coba"
          checked={preOps}
          onChange={(e) => setPreOps(e.target.checked)}
        />
      </Card>
      {report.isPending ? <Skeleton rows={4} /> : null}
      {report.error ? (
        <ErrorState title="Waduh, rekap belum kebuka." onRetry={() => void report.refetch()}>
          Cek sinyal, lalu coba lagi ya.
        </ErrorState>
      ) : null}
      {report.data && !cell ? (
        <Card>
          <EmptyState icon="📊" title="Belum ada data untuk bulan ini." />
        </Card>
      ) : null}
      {cell ? (
        <>
          {notes.map((n) => (
            <p key={n} className="mb-2 text-sm font-bold text-warm-ink">
              {n}
            </p>
          ))}
          <Summary cell={cell.total} />
          {viewAll && cell.per_outlet.length > 1 ? (
            <Card className="mt-4">
              <h2 className="mb-2 text-base">Perbandingan cabang</h2>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="text-[13px] text-muted">
                    <tr>
                      {['Cabang', 'Omzet', 'Pengeluaran', 'Laba sederhana'].map((h) => (
                        <th key={h} scope="col" className="px-2 py-2 font-extrabold">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {cell.per_outlet.map((c) => {
                      const o = outlets.find((x) => x.id === c.outlet_id);
                      return (
                        <tr key={c.outlet_id}>
                          <th scope="row" className="px-2 py-2 font-extrabold">
                            {o?.code} · {o?.name}
                          </th>
                          <td className="px-2 py-2 tabular-nums">{formatRupiah(c.revenue)}</td>
                          <td className="px-2 py-2 tabular-nums">
                            {formatRupiah(c.expense_total)}
                          </td>
                          <td
                            className={`px-2 py-2 font-extrabold tabular-nums ${c.profit < 0 ? 'text-danger' : ''}`}
                          >
                            {c.profit < 0 ? '▼ −' : ''}
                            {formatRupiah(Math.abs(c.profit))}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </Card>
          ) : null}
          <Breakdown cell={cell.total} />
          <p className="mt-4 flex items-start gap-2 text-[13px] text-muted">
            <Info size={16} aria-hidden="true" className="mt-0.5 shrink-0" />
            Omzet sama dengan Ringkasan: transaksi lunas + yang masih menunggu persetujuan batal.
            Batal yang disetujui dan transaksi terhapus tidak dihitung. Laba sederhana bukan laporan
            laba-rugi akuntansi (tanpa penyusutan, stok, atau akrual).
          </p>
        </>
      ) : null}
    </>
  );
}
