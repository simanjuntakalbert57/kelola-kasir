import { useQuery, type QueryClient } from '@tanstack/react-query';
import {
  DELETABLE_TRANSACTION_STATUSES,
  TRANSACTION_DELETE_REASON,
  type Transaction,
  type TransactionStatus,
} from '@kelola-kasir/contracts';
import { ApiError, api } from './api';

type Principal = { role: 'owner' | 'manager' | 'cashier' };

/** Only the owner role may delete or restore (a manager passes the owner guard but not this one, ADR-0019). */
export function useIsOwner(): boolean {
  const me = useQuery({
    queryKey: ['me'],
    queryFn: () => api<Principal>('/me'),
    staleTime: 5 * 60_000,
  });
  return me.data?.role === 'owner';
}

export const isDeletableStatus = (status: TransactionStatus): boolean =>
  (DELETABLE_TRANSACTION_STATUSES as readonly string[]).includes(status);

/** Inline validation message for the reason (length counted after trimming), or undefined when valid. */
export function reasonError(reason: string): string | undefined {
  const n = reason.trim().length;
  if (n < TRANSACTION_DELETE_REASON.min)
    return `Alasan minimal ${TRANSACTION_DELETE_REASON.min} karakter.`;
  if (n > TRANSACTION_DELETE_REASON.max)
    return `Alasan maksimal ${TRANSACTION_DELETE_REASON.max} karakter.`;
  return undefined;
}

/** Indonesian copy for the errors the delete/restore endpoints can answer. */
export function deletionErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.code === 'TRANSACTION_NOT_DELETABLE')
      return 'Transaksi ini belum bisa dihapus. Selesaikan pembayaran atau keputusan batalnya dulu.';
    if (error.status === 403)
      return 'Hanya pemilik yang boleh menghapus atau memulihkan transaksi.';
    if (error.status === 404) return 'Transaksi tidak ditemukan.';
    if (error.status === 400) return 'Alasan belum sesuai. Cek lagi ya.';
  }
  return 'Belum berhasil. Cek sinyal, lalu coba lagi.';
}

/** Everything that counts or lists transactions must refetch after a delete or restore. */
export async function invalidateAfterDeletion(qc: QueryClient): Promise<void> {
  await Promise.all(
    [
      'transactions',
      'transaction',
      'transactions-deleted',
      'dashboard',
      'reports',
      'shifts',
      'shift-summary',
      'void-requests',
    ].map((k) => qc.invalidateQueries({ queryKey: [k] })),
  );
}

export type DeletableTransaction = Pick<Transaction, 'id' | 'number' | 'total' | 'status'> & {
  client_created_at: string;
  paid_at?: string | null;
};
