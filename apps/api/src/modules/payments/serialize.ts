import { isoOrNull } from '../../lib/time.js';
import type { PaymentRow } from './provider.js';

export function toPayment(row: PaymentRow, qrImageUrl: string | null = null) {
  return {
    id: row.id,
    transaction_id: row.transactionId,
    method: row.method as 'cash' | 'qris',
    provider: row.provider as 'cash' | 'qris_static' | 'midtrans' | 'xendit',
    status: row.status as 'pending' | 'paid' | 'expired' | 'failed' | 'cancelled',
    amount: row.amount,
    cash_tendered: row.cashTendered,
    cash_change: row.cashChange,
    confirmation_mode: (row.confirmationMode ?? null) as 'manual' | 'auto' | null,
    qr_payload: row.qrPayload,
    qr_image_url: row.method === 'qris' ? qrImageUrl : null,
    expires_at: isoOrNull(row.expiresAt),
    confirmed_by: row.confirmedBy,
    paid_at: isoOrNull(row.paidAt),
  };
}

export type PaymentDto = ReturnType<typeof toPayment>;
