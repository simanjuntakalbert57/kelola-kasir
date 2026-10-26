import type { TransactionSummary } from '@kelola-kasir/contracts';
import { formatRupiah } from '@kelola-kasir/money';

/** Placeholder until F-1. */
export function transactionLabel(t: TransactionSummary): string {
  return `${t.number} · ${formatRupiah(t.total)}`;
}
