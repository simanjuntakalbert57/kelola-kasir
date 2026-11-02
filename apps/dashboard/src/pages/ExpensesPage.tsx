import { useInfiniteQuery, useMutation } from '@tanstack/react-query';
import {
  EXPENSE_FUNDING_SOURCE_LABELS,
  EXPENSE_FUNDING_SOURCES,
  EXPENSE_GROUPS,
  EXPENSE_GROUP_LABELS,
  type Expense,
  type ExpenseGroup,
} from '@kelola-kasir/contracts';
import { formatRupiah } from '@kelola-kasir/money';
import { Download, Plus } from 'lucide-react';
import { useState } from 'react';
import { DateRangePicker, type RangeState } from '../components/DateRangePicker';
import { ExpenseDetailDialog } from '../components/ExpenseDetail';
import { ExpenseForm } from '../components/ExpenseForm';
import { ExpenseTabs } from '../components/ExpenseTabs';
import {
  Alert,
  Badge,
  Button,
  Card,
  CheckboxField,
  EmptyState,
  ErrorState,
  Field,
  PageHeader,
  SelectField,
  Skeleton,
  Toast,
} from '../components/ui';
import { download, qs } from '../lib/api';
import { presetRange } from '../lib/dates';
import {
  expenseKey,
  formatDay,
  groupByDay,
  useExpenseCategories,
  useExpenseScope,
} from '../lib/expenses';
import { api } from '../lib/api';
import { errorMessage } from '../lib/format';
import { useDebounced } from '../lib/useDebounced';

interface ExpensePage {
  data: Expense[];
  next_cursor: string | null;
  summary: { count: number; total_amount: number };
}

function ExportButtons({ query }: { query: Record<string, string | boolean | undefined> }) {
  const [preOps, setPreOps] = useState(false);
  const exp = useMutation({
    mutationFn: async (format: 'csv' | 'xlsx') => {
      const { blob, filename } = await download(
        `/expenses/export${qs({ ...query, format, include_pre_operations: preOps || undefined })}`,
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
          checked={preOps}
          onChange={(e) => setPreOps(e.target.checked)}
        />
        Termasuk masa uji coba
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

export function ExpensesPage() {
  const { scope, outletId, outletName, isOwner, viewAll } = useExpenseScope();
  const [state, setState] = useState<RangeState>({ preset: 'month', range: presetRange('month') });
  const [categoryId, setCategoryId] = useState('');
  const [group, setGroup] = useState<ExpenseGroup | ''>('');
  const [funding, setFunding] = useState('');
  const [search, setSearch] = useState('');
  const [deletedView, setDeletedView] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const q = useDebounced(search.trim());
  const categories = useExpenseCategories(true);

  const filters = {
    date_from: state.range.from,
    date_to: state.range.to,
    category_id: categoryId,
    group,
    funding_source: funding,
    q,
    status: deletedView ? 'deleted' : 'active',
    outlet_scope: scope,
  };
  const list = useInfiniteQuery({
    queryKey: expenseKey('list', outletId, scope, filters),
    initialPageParam: '',
    queryFn: ({ pageParam }) =>
      api<ExpensePage>(`/expenses${qs({ ...filters, cursor: pageParam })}`),
    getNextPageParam: (last) => last.next_cursor ?? undefined,
  });
  const rows = list.data?.pages.flatMap((p) => p.data) ?? [];
  const summary = list.data?.pages[0]?.summary;
  const days = groupByDay(rows);
  const notify = (m: string) => {
    setToast(m);
    setTimeout(() => setToast(null), 4000);
  };

  return (
    <>
      <PageHeader
        title="Pengeluaran"
        subtitle={viewAll ? 'Semua cabang' : outletName}
        action={
          <Button
            variant="primary"
            disabled={viewAll}
            onClick={() => setAdding(true)}
            aria-describedby={viewAll ? 'all-hint' : undefined}
          >
            <Plus size={18} aria-hidden="true" />
            {viewAll ? 'Tambah (pilih cabang)' : 'Tambah pengeluaran'}
          </Button>
        }
      />
      <ExpenseTabs />
      {viewAll ? (
        <p
          id="all-hint"
          className="mb-3 rounded-2xl bg-info-bg px-3 py-2 text-sm font-bold text-info-ink"
        >
          Semua cabang: hanya melihat. Pilih satu cabang dulu untuk menambah atau mengubah.
        </p>
      ) : null}
      <Card className="mb-4">
        <DateRangePicker value={state} onChange={setState} />
        <div className="mt-3 grid gap-x-3 sm:grid-cols-2 lg:grid-cols-4">
          <SelectField
            label="Kategori"
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value)}
          >
            <option value="">Semua kategori</option>
            {viewAll
              ? null
              : categories.data?.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                    {c.archived ? ' (nonaktif)' : ''}
                  </option>
                ))}
          </SelectField>
          <SelectField
            label="Kelompok"
            value={group}
            onChange={(e) => setGroup(e.target.value as ExpenseGroup | '')}
          >
            <option value="">Semua kelompok</option>
            {EXPENSE_GROUPS.map((g) => (
              <option key={g} value={g}>
                {EXPENSE_GROUP_LABELS[g]}
              </option>
            ))}
          </SelectField>
          <SelectField
            label="Sumber dana"
            value={funding}
            onChange={(e) => setFunding(e.target.value)}
          >
            <option value="">Semua sumber</option>
            {EXPENSE_FUNDING_SOURCES.map((f) => (
              <option key={f} value={f}>
                {EXPENSE_FUNDING_SOURCE_LABELS[f]}
              </option>
            ))}
          </SelectField>
          <Field
            label="Cari"
            placeholder="Keterangan"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        {isOwner ? (
          <CheckboxField
            label="Riwayat Hapus (pengeluaran yang dihapus)"
            checked={deletedView}
            onChange={(e) => setDeletedView(e.target.checked)}
          />
        ) : null}
        <ExportButtons
          query={{
            date_from: filters.date_from,
            date_to: filters.date_to,
            category_id: categoryId,
            group,
            funding_source: funding,
            q,
            status: filters.status,
            outlet_scope: scope,
          }}
        />
      </Card>

      {summary ? (
        <p className="mb-3 text-sm font-bold" aria-live="polite">
          {summary.count} pengeluaran ·{' '}
          <span className="tabular-nums">Total {formatRupiah(summary.total_amount)}</span>
        </p>
      ) : null}
      {list.isPending ? <Skeleton /> : null}
      {list.error ? (
        <ErrorState
          title="Waduh, daftar pengeluaran belum kebuka."
          onRetry={() => void list.refetch()}
        >
          Cek sinyal, lalu coba lagi ya.
        </ErrorState>
      ) : null}
      {list.data && rows.length === 0 ? (
        <Card>
          <EmptyState
            icon={deletedView ? '🗑️' : '🧾'}
            title={
              deletedView
                ? 'Belum ada pengeluaran yang dihapus.'
                : `Belum ada pengeluaran di ${viewAll ? 'semua cabang' : outletName} pada rentang ini.`
            }
          >
            {!deletedView && !viewAll ? (
              <Button variant="primary" onClick={() => setAdding(true)}>
                Catat pengeluaran pertama
              </Button>
            ) : null}
          </EmptyState>
        </Card>
      ) : null}
      {days.map((d) => (
        <section key={d.date} aria-label={formatDay(d.date)} className="mb-4">
          <h2 className="mb-1 flex items-baseline justify-between text-sm text-muted">
            <span>{formatDay(d.date)}</span>
            <span className="tabular-nums">{formatRupiah(d.total)}</span>
          </h2>
          <ul className="space-y-2">
            {d.rows.map((r) => (
              <li key={r.id}>
                <button
                  type="button"
                  aria-label={`Detail ${r.category.name} ${formatRupiah(r.amount)}`}
                  onClick={() => setOpenId(r.id)}
                  className="flex min-h-16 w-full items-center gap-3 rounded-3xl bg-surface p-3 text-left shadow-card hover:bg-bg"
                >
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-1.5">
                      {viewAll ? (
                        <span className="rounded-lg bg-tint px-1.5 py-0.5 text-xs font-extrabold text-tint-ink">
                          {r.outlet.code}
                        </span>
                      ) : null}
                      <b className="font-extrabold">{r.category.name}</b>
                      <Badge tone="info">
                        {r.funding_source === 'drawer' ? 'Kas laci' : 'Uang owner'}
                      </Badge>
                    </span>
                    <span className="block truncate text-[13px] text-muted">
                      {r.description}
                      {r.receipt_url ? ' · 🧾 nota' : ''}
                    </span>
                    {r.deleted ? (
                      <span className="block text-[13px] text-danger">
                        Dihapus {r.deleted.deleted_by.name}: “{r.deleted.reason}”
                      </span>
                    ) : null}
                  </span>
                  <span className="shrink-0 font-extrabold tabular-nums">
                    {formatRupiah(r.amount)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
      {list.hasNextPage ? (
        <div className="flex justify-center">
          <Button
            small
            disabled={list.isFetchingNextPage}
            onClick={() => void list.fetchNextPage()}
          >
            Muat lagi
          </Button>
        </div>
      ) : null}
      {list.isFetchNextPageError ? <Alert>Gagal memuat lagi. Coba lagi.</Alert> : null}
      {adding ? <ExpenseForm onClose={() => setAdding(false)} onSaved={notify} /> : null}
      {openId ? (
        <ExpenseDetailDialog id={openId} onClose={() => setOpenId(null)} onSaved={notify} />
      ) : null}
      {toast ? <Toast>{toast}</Toast> : null}
    </>
  );
}
