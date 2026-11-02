import { useQuery, type QueryClient } from '@tanstack/react-query';
import {
  EXPENSE_DELETE_REASON,
  EXPENSE_LIMITS,
  type Expense,
  type ExpenseCategory,
  type ExpenseGroup,
} from '@kelola-kasir/contracts';
import { useAuth } from '../auth/AuthProvider';
import { ApiError, api, qs } from './api';
import { compressImage } from './image';
import { uploadImage } from './upload';

/** Extra scope param for list/report/export requests; "Semua cabang" is read-only (ADR-0020 §2). */
export function useExpenseScope() {
  const { activeOutletId, activeOutlet, role, viewAll } = useAuth();
  return {
    scope: viewAll ? ('all' as const) : ('current' as const),
    outletId: activeOutletId,
    outletName: activeOutlet?.name ?? '',
    isOwner: role === 'owner',
    viewAll,
  };
}

/** All expense queries carry the branch (and scope) in their key as a belt for late responses (ADR-0020 §5). */
export const expenseKey = (
  kind: string,
  outletId: string | null,
  scope: string,
  ...rest: unknown[]
) => ['expenses', kind, outletId, scope, ...rest];

export async function invalidateExpenses(qc: QueryClient): Promise<void> {
  await qc.invalidateQueries({ queryKey: ['expenses'] });
}

export function useExpenseCategories(includeArchived = false) {
  const { outletId } = useExpenseScope();
  return useQuery({
    queryKey: expenseKey('categories', outletId, 'current', includeArchived),
    queryFn: () =>
      api<{ data: ExpenseCategory[] }>(
        `/expense-categories${qs({ include_archived: includeArchived })}`,
      ).then((r) => r.data),
  });
}

export function groupCategories(categories: ExpenseCategory[], groups: readonly ExpenseGroup[]) {
  return groups
    .map((group) => ({
      group,
      items: categories
        .filter((c) => c.group === group)
        .sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name, 'id')),
    }))
    .filter((g) => g.items.length > 0);
}

const dateLong = new Intl.DateTimeFormat('id-ID', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
});
const dateDay = new Intl.DateTimeFormat('id-ID', {
  weekday: 'long',
  day: 'numeric',
  month: 'short',
  timeZone: 'UTC',
});
const monthLong = new Intl.DateTimeFormat('id-ID', {
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC',
});

/** `2026-11-03` → "3 Nov 2026" (calendar dates have no zone, so format them as UTC). */
export const formatDate = (ymd: string) => dateLong.format(new Date(`${ymd}T00:00:00Z`));
export const formatDay = (ymd: string) => dateDay.format(new Date(`${ymd}T00:00:00Z`));
/** `2026-11` → "November 2026". */
export const formatMonth = (ym: string) => monthLong.format(new Date(`${ym}-01T00:00:00Z`));

export function shiftMonth(ym: string, delta: number): string {
  const [y, m] = ym.split('-').map(Number) as [number, number];
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return d.toISOString().slice(0, 7);
}

/** Expenses grouped per business day, newest first, with the day subtotal. */
export function groupByDay(rows: Expense[]): { date: string; total: number; rows: Expense[] }[] {
  const days = new Map<string, Expense[]>();
  for (const r of rows) days.set(r.spent_on, [...(days.get(r.spent_on) ?? []), r]);
  return [...days.entries()]
    .sort(([a], [b]) => (a < b ? 1 : -1))
    .map(([date, list]) => ({
      date,
      rows: list,
      total: list.reduce((n, r) => n + r.amount, 0),
    }));
}

export function amountError(amount: number | null): string | undefined {
  if (amount === null || amount < EXPENSE_LIMITS.amountMin)
    return 'Isi jumlah dulu, contoh 125000.';
  if (amount > EXPENSE_LIMITS.amountMax) return 'Jumlah terlalu besar (maksimal Rp 1.000.000.000).';
  return undefined;
}

/** "Albert (Owner)" / "Budi (Manajer)": who did it, for the owner's audit view (DEAR-143). */
export function actorLabel(actor: Expense['created_by']): string {
  if (actor.role === 'owner') return `${actor.name} (Owner)`;
  if (actor.role === 'manager') return `${actor.name} (Manajer)`;
  return actor.name;
}

export function deleteReasonError(reason: string): string | undefined {
  const n = reason.trim().length;
  if (n < EXPENSE_DELETE_REASON.min) return `Alasan minimal ${EXPENSE_DELETE_REASON.min} karakter.`;
  if (n > EXPENSE_DELETE_REASON.max)
    return `Alasan maksimal ${EXPENSE_DELETE_REASON.max} karakter.`;
  return undefined;
}

/** Indonesian copy for the errors the expense endpoints answer. */
export function expenseErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    switch (error.code) {
      case 'EXPENSE_DELETED':
        return 'Pengeluaran ini sudah dihapus. Pulihkan dulu kalau mau mengubahnya.';
      case 'EXPENSE_CATEGORY_ARCHIVED':
        return 'Kategori ini sudah dinonaktifkan. Pilih kategori lain.';
      case 'EXPENSE_CATEGORY_NAME_TAKEN':
        return 'Nama kategori sudah dipakai. Pilih nama lain.';
      case 'INVALID_RECEIPT_URL':
        return 'Foto nota tidak valid. Ambil ulang fotonya.';
      case 'ID_REUSED':
        return 'Data ini sudah tersimpan dengan isi berbeda. Muat ulang halaman.';
    }
    if (error.status === 403) return 'Peran Anda tidak boleh melakukan ini.';
    if (error.status === 404) return 'Pengeluaran tidak ditemukan.';
    if (error.status === 400 || error.status === 422)
      return error.message || 'Data belum sesuai. Cek lagi ya.';
  }
  return 'Gagal menyimpan. Periksa sinyal lalu coba lagi.';
}

/** Compresses a receipt photo in the browser, then uploads it (`POST /uploads` → PUT); returns its URL. */
export async function uploadReceipt(file: File): Promise<string> {
  const small = await compressImage(file, EXPENSE_LIMITS.receiptTargetBytes);
  return uploadImage(small, 'expense_receipt', EXPENSE_LIMITS.receiptMaxBytes);
}

/** UUIDv7, so a double-submitted create is idempotent on the API (ADR-0008). */
export function uuidv7(
  now: number = Date.now(),
  rand: Uint8Array = crypto.getRandomValues(new Uint8Array(10)),
): string {
  const b = new Uint8Array(16);
  const ts = BigInt(now);
  for (let i = 0; i < 6; i++) b[i] = Number((ts >> BigInt(8 * (5 - i))) & 0xffn);
  b.set(rand, 6);
  b[6] = ((b[6] ?? 0) & 0x0f) | 0x70;
  b[8] = ((b[8] ?? 0) & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
