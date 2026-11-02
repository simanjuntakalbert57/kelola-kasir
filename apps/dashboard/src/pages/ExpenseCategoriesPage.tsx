import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  EXPENSE_GROUPS,
  EXPENSE_GROUP_LABELS,
  EXPENSE_LIMITS,
  type ExpenseCategory,
  type ExpenseGroup,
} from '@kelola-kasir/contracts';
import { Pencil, Plus } from 'lucide-react';
import { useId, useState } from 'react';
import { ExpenseTabs } from '../components/ExpenseTabs';
import {
  Alert,
  Button,
  Card,
  ConfirmDialog,
  Dialog,
  EmptyState,
  ErrorState,
  Field,
  PageHeader,
  SelectField,
  Skeleton,
  Switch,
} from '../components/ui';
import { patch, post } from '../lib/api';
import {
  expenseErrorMessage,
  groupCategories,
  invalidateExpenses,
  useExpenseCategories,
  useExpenseScope,
} from '../lib/expenses';

function CategoryDialog({
  category,
  onClose,
}: {
  category?: ExpenseCategory;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [name, setName] = useState(category?.name ?? '');
  const [group, setGroup] = useState<ExpenseGroup>(category?.group ?? 'hpp');
  const [touched, setTouched] = useState(false);
  const trimmed = name.trim();
  const invalid =
    trimmed.length === 0
      ? 'Nama wajib diisi.'
      : trimmed.length > EXPENSE_LIMITS.categoryNameMax
        ? `Maksimal ${EXPENSE_LIMITS.categoryNameMax} karakter.`
        : undefined;
  const save = useMutation({
    mutationFn: () =>
      category
        ? patch(`/expense-categories/${category.id}`, { name: trimmed, group })
        : post('/expense-categories', { name: trimmed, group }),
    onSuccess: async () => {
      await invalidateExpenses(qc);
      onClose();
    },
  });
  return (
    <Dialog title={category ? 'Ganti nama kategori' : 'Tambah kategori'} onClose={onClose}>
      {save.error ? <Alert>{expenseErrorMessage(save.error)}</Alert> : null}
      <Field
        label="Nama kategori"
        value={name}
        maxLength={EXPENSE_LIMITS.categoryNameMax + 10}
        onChange={(e) => setName(e.target.value)}
        onBlur={() => setTouched(true)}
        error={touched ? invalid : undefined}
      />
      <SelectField
        label="Kelompok"
        value={group}
        onChange={(e) => setGroup(e.target.value as ExpenseGroup)}
      >
        {EXPENSE_GROUPS.map((g) => (
          <option key={g} value={g}>
            {EXPENSE_GROUP_LABELS[g]}
          </option>
        ))}
      </SelectField>
      <div className="mt-2 flex gap-2">
        <Button
          variant="primary"
          disabled={Boolean(invalid) || save.isPending}
          onClick={() => save.mutate()}
        >
          {save.isPending ? 'Menyimpan…' : 'Simpan'}
        </Button>
        <Button onClick={onClose}>Batal</Button>
      </div>
    </Dialog>
  );
}

function CategoryRow({
  category,
  onEdit,
  onToggle,
}: {
  category: ExpenseCategory;
  onEdit: () => void;
  onToggle: (archived: boolean) => void;
}) {
  const labelId = useId();
  return (
    <li className="flex min-h-14 items-center gap-2 rounded-2xl bg-surface px-3 shadow-card">
      <span
        id={labelId}
        className={`min-w-0 flex-1 font-extrabold ${category.archived ? 'text-muted line-through' : ''}`}
      >
        {category.name}
        {category.archived ? <small className="ml-2 font-bold no-underline">Nonaktif</small> : null}
      </span>
      <button
        type="button"
        aria-label={`Ganti nama ${category.name}`}
        onClick={onEdit}
        className="grid size-11 place-items-center rounded-2xl text-muted hover:bg-bg"
      >
        <Pencil size={18} aria-hidden="true" />
      </button>
      <Switch checked={!category.archived} labelledBy={labelId} onChange={(on) => onToggle(!on)} />
    </li>
  );
}

/** Owner only: add, rename, reorder-free archive/activate (categories are never deleted, ADR-0021). */
export function ExpenseCategoriesPage() {
  const qc = useQueryClient();
  const { isOwner, viewAll } = useExpenseScope();
  const categories = useExpenseCategories(true);
  const [editing, setEditing] = useState<ExpenseCategory | 'new' | null>(null);
  const [archiving, setArchiving] = useState<ExpenseCategory | null>(null);
  const toggle = useMutation({
    mutationFn: ({ id, archived }: { id: string; archived: boolean }) =>
      patch(`/expense-categories/${id}`, { archived }),
    onSuccess: async () => {
      await invalidateExpenses(qc);
      setArchiving(null);
    },
  });

  if (!isOwner || viewAll) {
    return (
      <>
        <PageHeader title="Kelola kategori" />
        <Card>
          <EmptyState icon="🔒" title="Kelola kategori hanya untuk pemilik di satu cabang.">
            <p>Pilih satu cabang, lalu masuk sebagai pemilik.</p>
          </EmptyState>
        </Card>
      </>
    );
  }
  const grouped = groupCategories(categories.data ?? [], EXPENSE_GROUPS);
  return (
    <>
      <PageHeader
        title="Kelola kategori"
        action={
          <Button variant="primary" onClick={() => setEditing('new')}>
            <Plus size={18} aria-hidden="true" />
            Tambah kategori
          </Button>
        }
      />
      <ExpenseTabs />
      {toggle.error ? <Alert>{expenseErrorMessage(toggle.error)}</Alert> : null}
      {categories.isPending ? <Skeleton /> : null}
      {categories.error ? (
        <ErrorState onRetry={() => void categories.refetch()}>Kategori belum kebuka.</ErrorState>
      ) : null}
      {grouped.map((g) => (
        <section key={g.group} aria-label={EXPENSE_GROUP_LABELS[g.group]} className="mb-4">
          <h2 className="mb-1 text-sm text-muted">{EXPENSE_GROUP_LABELS[g.group]}</h2>
          <ul className="space-y-2">
            {g.items.map((c) => (
              <CategoryRow
                key={c.id}
                category={c}
                onEdit={() => setEditing(c)}
                onToggle={(archived) =>
                  archived ? setArchiving(c) : toggle.mutate({ id: c.id, archived: false })
                }
              />
            ))}
          </ul>
        </section>
      ))}
      {editing ? (
        <CategoryDialog
          {...(editing === 'new' ? {} : { category: editing })}
          onClose={() => setEditing(null)}
        />
      ) : null}
      {archiving ? (
        <ConfirmDialog
          title={`Nonaktifkan ${archiving.name}?`}
          confirmLabel="Nonaktifkan"
          pending={toggle.isPending}
          onConfirm={() => toggle.mutate({ id: archiving.id, archived: true })}
          onClose={() => setArchiving(null)}
        >
          Kategori “{archiving.name}” tidak akan muncul di form baru. Data lama tetap ada.
        </ConfirmDialog>
      ) : null}
    </>
  );
}
