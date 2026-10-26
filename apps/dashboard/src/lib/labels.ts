import type { PaymentMethod, TransactionStatus } from '@kelola-kasir/contracts';

export const STATUS_LABEL: Record<
  TransactionStatus,
  { tone: 'ok' | 'off' | 'warn'; label: string }
> = {
  pending: { tone: 'warn', label: 'Menunggu bayar' },
  paid: { tone: 'ok', label: 'Lunas' },
  void_requested: { tone: 'warn', label: 'Menunggu void' },
  voided: { tone: 'off', label: 'Dibatalkan' },
  cancelled: { tone: 'off', label: 'Batal' },
};

export const METHOD_LABEL: Record<PaymentMethod, string> = { cash: 'Cash', qris: 'QRIS' };
