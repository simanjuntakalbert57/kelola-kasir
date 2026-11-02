import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  EXPENSE_DELETE_REASON,
  EXPENSE_GROUP_LABELS,
  type Expense,
  type ExpenseDetail as ExpenseDetailData,
} from '@kelola-kasir/contracts';
import { formatRupiah } from '@kelola-kasir/money';
import { ArchiveRestore, Pencil, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { api } from '../lib/api';
import {
  deleteReasonError,
  expenseErrorMessage,
  formatDate,
  invalidateExpenses,
  useExpenseScope,
} from '../lib/expenses';
import { formatDateTime } from '../lib/format';
import { ExpenseForm } from './ExpenseForm';
import { Alert, Button, Dialog, Skeleton, TextareaField } from './ui';

const ACTION_LABEL = {
  create: 'Dicatat',
  update: 'Diubah',
  delete: 'Dihapus',
  restore: 'Dipulihkan',
} as const;

function DeleteDialog({ expense, onClose }: { expense: Expense; onClose: () => void }) {
  const qc = useQueryClient();
  const [reason, setReason] = useState('');
  const [touched, setTouched] = useState(false);
  const invalid = deleteReasonError(reason);
  const del = useMutation({
    mutationFn: () =>
      api(`/expenses/${expense.id}`, {
        method: 'DELETE',
        body: JSON.stringify({ reason: reason.trim() }),
      }),
    onSuccess: async () => {
      await invalidateExpenses(qc);
      onClose();
    },
  });
  return (
    <Dialog title="Hapus pengeluaran ini?" onClose={onClose}>
      {del.error ? <Alert>{expenseErrorMessage(del.error)}</Alert> : null}
      <p className="mb-3 text-sm text-muted">
        {expense.category.name} {formatRupiah(expense.amount)} ({formatDate(expense.spent_on)}).
        Data tetap ada di Riwayat Hapus dan bisa dipulihkan.
      </p>
      <TextareaField
        label="Alasan menghapus"
        placeholder="Contoh: salah input, nota dobel"
        value={reason}
        maxLength={EXPENSE_DELETE_REASON.max + 50}
        onChange={(e) => setReason(e.target.value)}
        onBlur={() => setTouched(true)}
        error={touched ? invalid : undefined}
        hint={`${reason.trim().length}/${EXPENSE_DELETE_REASON.max} karakter (minimal ${EXPENSE_DELETE_REASON.min})`}
      />
      <div className="mt-2 flex gap-2">
        <Button
          variant="danger"
          disabled={Boolean(invalid) || del.isPending}
          onClick={() => del.mutate()}
        >
          {del.isPending ? 'Menghapus…' : 'Hapus'}
        </Button>
        <Button onClick={onClose}>Batal</Button>
      </div>
    </Dialog>
  );
}

/** Detail + history of one expense, with edit (owner/manager), delete and restore (owner). */
export function ExpenseDetailDialog({
  id,
  onClose,
  onSaved,
}: {
  id: string;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const qc = useQueryClient();
  const { isOwner, viewAll, outletId } = useExpenseScope();
  const [mode, setMode] = useState<'view' | 'edit' | 'delete'>('view');
  const detail = useQuery({
    queryKey: ['expenses', 'detail', outletId, id],
    queryFn: () => api<ExpenseDetailData>(`/expenses/${id}`),
  });
  const restore = useMutation({
    mutationFn: () => api(`/expenses/${id}/restore`, { method: 'POST', body: '{}' }),
    onSuccess: async () => {
      await invalidateExpenses(qc);
      onClose();
    },
  });
  const e = detail.data;

  if (mode === 'edit' && e) return <ExpenseForm expense={e} onClose={onClose} onSaved={onSaved} />;
  if (mode === 'delete' && e) return <DeleteDialog expense={e} onClose={onClose} />;

  return (
    <Dialog title="Detail pengeluaran" onClose={onClose}>
      {detail.isPending ? <Skeleton rows={3} /> : null}
      {detail.error ? <Alert>{expenseErrorMessage(detail.error)}</Alert> : null}
      {restore.error ? <Alert>{expenseErrorMessage(restore.error)}</Alert> : null}
      {e ? (
        <>
          <dl className="mb-3 rounded-2xl bg-tint p-3 text-sm">
            {[
              ['Cabang', `${e.outlet.code} · ${e.outlet.name}`],
              ['Tanggal', formatDate(e.spent_on)],
              ['Kategori', `${e.category.name} (${EXPENSE_GROUP_LABELS[e.category.group]})`],
              ['Keterangan', e.description],
              ['Jumlah', formatRupiah(e.amount)],
              ['Dibayar dari', e.funding_source === 'drawer' ? 'Kas laci' : 'Uang owner'],
              ['Dicatat oleh', e.created_by.name],
            ].map(([k, v]) => (
              <div key={k} className="flex justify-between gap-3 py-0.5">
                <dt className="text-muted">{k}</dt>
                <dd className="text-right font-extrabold">{v}</dd>
              </div>
            ))}
          </dl>
          {e.receipt_url ? (
            <a
              href={e.receipt_url}
              target="_blank"
              rel="noreferrer"
              className="mb-3 inline-flex min-h-11 items-center text-sm font-extrabold text-pri underline"
            >
              Buka foto nota
            </a>
          ) : null}
          {e.deleted ? (
            <p className="mb-3 text-sm text-danger">
              Dihapus oleh {e.deleted.deleted_by.name} · {formatDateTime(e.deleted.deleted_at)}: “
              {e.deleted.reason}”
            </p>
          ) : null}
          <section aria-label="Riwayat perubahan" className="mb-3">
            <h3 className="mb-1 text-base">Riwayat</h3>
            <ol className="space-y-2 border-l-2 border-line pl-3 text-sm">
              {e.history.map((h) => (
                <li key={h.id}>
                  <b>{ACTION_LABEL[h.action]}</b> oleh {h.actor.name} ·{' '}
                  {formatDateTime(h.created_at)}
                  {h.reason ? <span className="block text-muted">“{h.reason}”</span> : null}
                </li>
              ))}
            </ol>
          </section>
          {viewAll ? (
            <p className="mb-2 text-[13px] text-muted">
              Semua cabang: hanya melihat. Pilih satu cabang dulu untuk mengubah.
            </p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {e.deleted ? (
                isOwner ? (
                  <Button
                    variant="primary"
                    disabled={restore.isPending}
                    onClick={() => restore.mutate()}
                  >
                    <ArchiveRestore size={18} aria-hidden="true" />
                    {restore.isPending ? 'Memulihkan…' : 'Pulihkan'}
                  </Button>
                ) : null
              ) : (
                <>
                  <Button variant="primary" onClick={() => setMode('edit')}>
                    <Pencil size={18} aria-hidden="true" />
                    Ubah
                  </Button>
                  {isOwner ? (
                    <Button variant="danger" onClick={() => setMode('delete')}>
                      <Trash2 size={18} aria-hidden="true" />
                      Hapus
                    </Button>
                  ) : null}
                </>
              )}
              <Button onClick={onClose}>Tutup</Button>
            </div>
          )}
        </>
      ) : null}
    </Dialog>
  );
}
