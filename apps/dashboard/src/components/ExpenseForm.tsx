import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  EXPENSE_GROUPS,
  EXPENSE_GROUP_LABELS,
  EXPENSE_LIMITS,
  type Expense,
  type ExpenseFundingSource,
  type OutletSettings,
} from '@kelola-kasir/contracts';
import { formatRupiah } from '@kelola-kasir/money';
import { Camera, ImagePlus, Trash2, TriangleAlert } from 'lucide-react';
import { useId, useRef, useState } from 'react';
import { useAuth } from '../auth/AuthProvider';
import { api, patch, post } from '../lib/api';
import { wibDate } from '../lib/dates';
import {
  amountError,
  expenseErrorMessage,
  formatDate,
  groupCategories,
  invalidateExpenses,
  useExpenseCategories,
  uploadReceipt,
  uuidv7,
} from '../lib/expenses';
import { Alert, Button, Dialog, Field, Skeleton } from './ui';

const FUNDING_KEY = 'kk_expense_funding';

function lastFunding(): ExpenseFundingSource {
  try {
    return localStorage.getItem(FUNDING_KEY) === 'owner' ? 'owner' : 'drawer';
  } catch {
    return 'drawer';
  }
}

const digits = (v: string) => v.replace(/\D/g, '').replace(/^0+/, '');
const toNumber = (v: string) => (v === '' ? null : Number(v));
const pretty = (v: string) => (v === '' ? '' : new Intl.NumberFormat('id-ID').format(Number(v)));

/** Add / edit expense dialog. The branch is fixed to the active one; change it from the header picker. */
export function ExpenseForm({
  expense,
  onClose,
  onSaved,
}: {
  /** Present = edit mode. */
  expense?: Expense;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const qc = useQueryClient();
  const { activeOutlet } = useAuth();
  const categories = useExpenseCategories();
  const radioName = useId();
  const fileRef = useRef<HTMLInputElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);
  // One id per opened form: a double tap on Simpan is idempotent on the API (ADR-0008).
  const clientId = useRef(uuidv7());

  const [amount, setAmount] = useState(expense ? String(expense.amount) : '');
  const [categoryId, setCategoryId] = useState(expense?.category.id ?? '');
  const [spentOn, setSpentOn] = useState(expense?.spent_on ?? wibDate());
  const [description, setDescription] = useState(expense?.description ?? '');
  const [funding, setFunding] = useState<ExpenseFundingSource>(
    expense?.funding_source ?? lastFunding(),
  );
  const [receipt, setReceipt] = useState<string | null>(expense?.receipt_url ?? null);
  const [uploading, setUploading] = useState(false);
  const [receiptError, setReceiptError] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);

  const amountMsg = amountError(toNumber(amount));
  const categoryMsg = categoryId ? undefined : 'Pilih kategori.';
  const grouped = groupCategories(categories.data ?? [], EXPENSE_GROUPS);
  const chosen = categories.data?.find((c) => c.id === categoryId);
  const outletName = activeOutlet?.name ?? 'cabang ini';
  const settings = useQuery({
    queryKey: ['settings'],
    queryFn: () => api<OutletSettings>('/settings'),
    staleTime: 60_000,
  });
  const startedOn = settings.data?.operations_started_on ?? activeOutlet?.operations_started_on;
  const beforeStart = Boolean(startedOn && spentOn < startedOn);
  const today = wibDate();

  const save = useMutation({
    mutationFn: async () => {
      const body = {
        category_id: categoryId,
        spent_on: spentOn,
        // The description is optional in the design; the API requires one, so fall back to the category name.
        description: description.trim() || chosen?.name || 'Pengeluaran',
        amount: Number(amount),
        funding_source: funding,
        receipt_url: receipt,
      };
      return expense
        ? patch<Expense>(`/expenses/${expense.id}`, body)
        : post<Expense>('/expenses', { id: clientId.current, ...body });
    },
    onSuccess: async (saved) => {
      try {
        localStorage.setItem(FUNDING_KEY, funding);
      } catch {
        // Not persisting the last choice is harmless.
      }
      await invalidateExpenses(qc);
      onSaved(
        `Tersimpan: ${saved.category.name} ${formatRupiah(saved.amount)} di ${saved.outlet.name}.`,
      );
      onClose();
    },
  });

  async function pickReceipt(file: File | undefined) {
    if (!file) return;
    setUploading(true);
    setReceiptError(null);
    try {
      setReceipt(await uploadReceipt(file));
    } catch (e) {
      setReceiptError(e instanceof Error ? e.message : 'Foto terlalu besar, coba ambil ulang.');
    } finally {
      setUploading(false);
    }
  }

  function submit() {
    setTouched(true);
    if (amountMsg || categoryMsg || uploading) return;
    save.mutate();
  }

  return (
    <Dialog title={expense ? 'Ubah pengeluaran' : 'Catat pengeluaran'} onClose={onClose}>
      {save.error ? <Alert>{expenseErrorMessage(save.error)}</Alert> : null}
      <p className="mb-3 inline-flex items-center gap-2 rounded-full bg-tint px-3 py-1 text-[13px] font-extrabold text-tint-ink">
        {activeOutlet?.code} · {outletName}
      </p>
      <Field
        label="Jumlah (Rp)"
        inputMode="numeric"
        autoComplete="off"
        placeholder="0"
        value={pretty(amount)}
        onChange={(e) => setAmount(digits(e.target.value))}
        error={touched ? amountMsg : undefined}
        {...(amount && !amountMsg ? { hint: formatRupiah(Number(amount)) } : {})}
      />
      <fieldset className="mb-3.5">
        <legend className="mb-1 text-sm font-extrabold">Kategori</legend>
        {categories.isPending ? <Skeleton rows={2} /> : null}
        {categories.error ? (
          <Alert>Kategori belum kebuka. Cek sinyal, lalu coba lagi.</Alert>
        ) : null}
        {grouped.map((g) => (
          <div key={g.group} className="mb-2">
            <p className="mb-1 text-xs font-bold text-muted">{EXPENSE_GROUP_LABELS[g.group]}</p>
            <div className="flex flex-wrap gap-2">
              {g.items.map((c) => (
                <label
                  key={c.id}
                  className={`min-h-11 cursor-pointer rounded-full px-3.5 py-2.5 text-sm font-bold ring-1 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-pri ${categoryId === c.id ? 'bg-pri text-pri-ink ring-pri' : 'bg-surface ring-line-strong hover:bg-bg'}`}
                >
                  <input
                    type="radio"
                    name={`${radioName}-cat`}
                    value={c.id}
                    checked={categoryId === c.id}
                    onChange={() => setCategoryId(c.id)}
                    className="sr-only"
                  />
                  {c.name}
                </label>
              ))}
            </div>
          </div>
        ))}
        {touched && categoryMsg ? (
          <p role="alert" className="mt-1 text-[13px] text-danger">
            {categoryMsg}
          </p>
        ) : null}
      </fieldset>
      <Field
        label="Tanggal"
        type="date"
        value={spentOn}
        min={EXPENSE_LIMITS.earliestSpentOn}
        max={today}
        onChange={(e) => setSpentOn(e.target.value)}
      />
      {beforeStart ? (
        <p className="-mt-2 mb-3 flex items-start gap-1.5 text-[13px] font-bold text-warm-ink">
          <TriangleAlert size={16} aria-hidden="true" className="mt-0.5 shrink-0" />
          Tanggal ini sebelum cabang mulai beroperasi, jadi tidak masuk Rekap.
        </p>
      ) : null}
      <Field
        label="Keterangan (opsional)"
        placeholder="Contoh: Mangga 10 kg"
        maxLength={EXPENSE_LIMITS.descriptionMax}
        value={description}
        onChange={(e) => setDescription(e.target.value)}
      />
      <fieldset className="mb-3.5">
        <legend className="mb-1 text-sm font-extrabold">Dibayar dari</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {(['drawer', 'owner'] as const).map((f) => (
            <label
              key={f}
              className={`flex min-h-12 cursor-pointer items-center gap-2 rounded-2xl px-3 text-sm font-bold ring-1 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-pri ${funding === f ? 'bg-tint text-tint-ink ring-2 ring-pri' : 'bg-surface ring-line-strong'}`}
            >
              <input
                type="radio"
                name={`${radioName}-fund`}
                checked={funding === f}
                onChange={() => setFunding(f)}
                className="size-4 accent-pri"
              />
              {f === 'drawer' ? `Kas laci ${outletName}` : 'Uang owner'}
            </label>
          ))}
        </div>
      </fieldset>
      <div className="mb-3.5">
        <p className="mb-1 text-sm font-extrabold">Foto nota (opsional)</p>
        <div className="flex items-center gap-3">
          {receipt ? (
            <img
              src={receipt}
              alt="Pratinjau foto nota"
              className="size-20 shrink-0 rounded-2xl border border-line object-cover"
            />
          ) : (
            <div
              aria-hidden="true"
              className="grid size-20 shrink-0 place-items-center rounded-2xl border-2 border-dashed border-line bg-tint text-muted"
            >
              <ImagePlus size={28} />
            </div>
          )}
          <div className="flex flex-col items-start gap-1.5">
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              capture="environment"
              aria-label="Ambil foto nota"
              className="sr-only"
              onChange={(e) => {
                void pickReceipt(e.target.files?.[0]);
                e.target.value = '';
              }}
            />
            <input
              ref={galleryRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              aria-label="Pilih foto nota dari galeri"
              className="sr-only"
              onChange={(e) => {
                void pickReceipt(e.target.files?.[0]);
                e.target.value = '';
              }}
            />
            <Button small disabled={uploading} onClick={() => fileRef.current?.click()}>
              <Camera size={16} aria-hidden="true" />
              Ambil foto
            </Button>
            <Button small disabled={uploading} onClick={() => galleryRef.current?.click()}>
              Pilih dari galeri
            </Button>
            {receipt ? (
              <Button small disabled={uploading} onClick={() => setReceipt(null)}>
                <Trash2 size={16} aria-hidden="true" />
                Hapus foto
              </Button>
            ) : null}
          </div>
        </div>
        {uploading ? (
          <p role="status" className="mt-1 text-[13px] text-muted">
            Memperkecil dan mengunggah foto…
          </p>
        ) : null}
        {receiptError ? (
          <p role="alert" className="mt-1 text-[13px] text-danger">
            {receiptError}
          </p>
        ) : null}
      </div>
      <div className="flex gap-2">
        <Button variant="primary" disabled={save.isPending || uploading} onClick={submit}>
          {save.isPending ? 'Menyimpan…' : expense ? 'Simpan perubahan' : 'Simpan'}
        </Button>
        <Button onClick={onClose}>Batal</Button>
      </div>
      {expense && expense.spent_on !== spentOn ? (
        <p className="mt-2 text-[13px] text-muted">Tanggal lama: {formatDate(expense.spent_on)}</p>
      ) : null}
    </Dialog>
  );
}
