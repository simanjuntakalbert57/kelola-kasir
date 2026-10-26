import type { Db } from '../db/types';
import { get } from '../db/types';
import { uuidv7 } from '../lib/uuid';
import { enqueueMutation } from '../sync/outbox';

export const VOID_REASON_MIN = 3;
export const VOID_REASON_MAX = 300;

export class VoidError extends Error {
  override readonly name = 'VoidError';
}

export function validateVoidReason(reason: string): string {
  const trimmed = reason.trim();
  if (trimmed.length < VOID_REASON_MIN) throw new VoidError('Alasan wajib diisi (min. 3 huruf).');
  if (trimmed.length > VOID_REASON_MAX) throw new VoidError('Alasan maksimal 300 huruf.');
  return trimmed;
}

/**
 * Void request (M-14, P-10): the transaction moves to "Menunggu void" on this device at once and the
 * request is queued, so it works offline. The owner approves in the dashboard.
 * Only a `paid` transaction can be voided.
 */
export async function requestVoid(
  db: Db,
  input: { transactionId: string; reason: string; employeeId: string },
  now: Date = new Date(),
): Promise<void> {
  const reason = validateVoidReason(input.reason);
  await db.transaction(async (tx) => {
    const row = await get<{ status: string }>(tx, 'SELECT status FROM transactions WHERE id = ?', [
      input.transactionId,
    ]);
    if (row?.status !== 'paid')
      throw new VoidError('Hanya transaksi lunas yang bisa diajukan void.');
    await tx.run(
      "UPDATE transactions SET status = 'void_requested', void_reason = ? WHERE id = ?",
      [reason, input.transactionId],
    );
    const id = uuidv7(now.getTime());
    await enqueueMutation(tx, {
      id,
      type: 'void_request.create',
      employeeId: input.employeeId,
      clientCreatedAt: now.toISOString(),
      payload: { id, transaction_id: input.transactionId, reason },
    });
  });
}
