import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { auditLogs, payments, transactions } from '../src/db/schema.js';
import { parseQris } from '../src/lib/qris.js';
import { StaticQrisProvider } from '../src/modules/payments/provider.js';
import { startExpiryJob } from '../src/modules/payments/service.js';
import {
  bearer,
  buildQris,
  cashierSession,
  createShop,
  createTestEnv,
  get,
  json,
  patch,
  post,
  txBody,
  type Shop,
  type TestEnv,
} from './helpers.js';

let env: TestEnv;
beforeAll(async () => {
  env = await createTestEnv();
});
afterAll(async () => {
  await env.close();
});

interface PaymentDto {
  id: string;
  status: string;
  provider: string;
  method: string;
  amount: number;
  confirmation_mode: string | null;
  qr_payload: string | null;
  qr_image_url: string | null;
  expires_at: string | null;
  confirmed_by: string | null;
  paid_at: string | null;
}
interface TxDto {
  id: string;
  status: string;
  paid_at: string | null;
  payments: PaymentDto[];
}

async function qrisSale(shop: Shop, qty = 2) {
  const body = txBody(env, shop, { method: 'qris', qty });
  const res = await post(env, '/v1/transactions', shop.cashier.headers, body);
  expect(res.statusCode).toBe(201);
  const tx = json<TxDto>(res);
  const payment = tx.payments[0];
  if (!payment) throw new Error('no payment');
  return { body, tx, payment };
}

const confirm = (shop: Shop, paymentId: string, headers = shop.cashier.headers) =>
  post(env, `/v1/payments/${paymentId}/confirm`, headers, {});
const cancel = (shop: Shop, paymentId: string, headers = shop.cashier.headers) =>
  post(env, `/v1/payments/${paymentId}/cancel`, headers, {});

const auditActions = async (shop: Shop) =>
  (
    await env.handle.db
      .select({ action: auditLogs.action })
      .from(auditLogs)
      .where(eq(auditLogs.outletId, shop.seeded.outletId))
  ).map((a) => a.action);

describe('QRIS transaction creation', () => {
  it('creates a pending transaction with the static QR, manual confirmation and a 15 minute deadline', async () => {
    const shop = await createShop(env);
    const { tx, payment } = await qrisSale(shop);
    expect(tx.status).toBe('pending');
    expect(tx.paid_at).toBeNull();
    expect(payment).toMatchObject({
      method: 'qris',
      provider: 'qris_static',
      status: 'pending',
      amount: 30_000,
      confirmation_mode: 'manual',
      paid_at: null,
      confirmed_by: null,
    });
    expect(payment.qr_payload).toBe(buildQris());
    expect(new Date(payment.expires_at ?? '').getTime()).toBe(
      env.clock.now.getTime() + 15 * 60_000,
    );
  });

  it('embeds the amount (tag 54) with a valid CRC when the owner enabled it', async () => {
    const shop = await createShop(env);
    await patch(env, '/v1/settings', bearer(shop.ownerToken), { qris_embed_amount: true });
    const { payment } = await qrisSale(shop, 3);
    const parsed = parseQris(payment.qr_payload ?? '');
    expect(parsed.amount).toBe('45000');
    expect(parsed.initiationMethod).toBe('12');
    expect(parsed.merchantName).toBe('JUS KELOLA');
  });

  it('exposes the uploaded QR image as fallback', async () => {
    const shop = await createShop(env);
    await patch(env, '/v1/settings', bearer(shop.ownerToken), {
      qris_static_image_url: 'https://media.example/qris.png',
    });
    const { payment, tx } = await qrisSale(shop);
    expect(payment.qr_image_url).toBe('https://media.example/qris.png');
    const polled = json<PaymentDto>(
      await get(env, `/v1/payments/${payment.id}`, shop.cashier.headers),
    );
    expect(polled.qr_image_url).toBe('https://media.example/qris.png');
    expect(tx.id).toBeTruthy();
  });

  it('answers 503 QRIS_PROVIDER_UNAVAILABLE while the store has no QRIS set up', async () => {
    const shop = await createShop(env, { qris: false });
    const res = await post(
      env,
      '/v1/transactions',
      shop.cashier.headers,
      txBody(env, shop, { method: 'qris' }),
    );
    expect(res.statusCode).toBe(503);
    expect(json(res)).toMatchObject({ code: 'QRIS_PROVIDER_UNAVAILABLE' });
    // Nothing was stored, cash still works.
    expect(
      (await post(env, '/v1/transactions', shop.cashier.headers, txBody(env, shop))).statusCode,
    ).toBe(201);
  });

  it('is idempotent: a retry returns the same pending payment', async () => {
    const shop = await createShop(env);
    const { body, payment } = await qrisSale(shop);
    const retry = await post(env, '/v1/transactions', shop.cashier.headers, body);
    expect(retry.statusCode).toBe(200);
    expect(json<TxDto>(retry).payments).toHaveLength(1);
    expect(json<TxDto>(retry).payments[0]?.id).toBe(payment.id);
  });

  it('does not count a pending QRIS sale in the shift totals', async () => {
    const shop = await createShop(env);
    await qrisSale(shop);
    const summary = json<{ total_qris_sales: number; transaction_count: number }>(
      await get(env, `/v1/shifts/${shop.shiftId}/summary`, shop.cashier.headers),
    );
    expect(summary).toMatchObject({ total_qris_sales: 0, transaction_count: 0 });
  });
});

describe('manual confirmation', () => {
  it('marks payment and transaction paid, records who confirmed, and audits it', async () => {
    const shop = await createShop(env);
    const { tx, payment } = await qrisSale(shop);
    env.clock.advance(60_000);
    const res = await confirm(shop, payment.id);
    expect(res.statusCode).toBe(200);
    const paid = json<TxDto>(res);
    expect(paid).toMatchObject({ id: tx.id, status: 'paid' });
    expect(paid.paid_at).toBe(env.clock.now.toISOString());
    expect(paid.payments[0]).toMatchObject({
      status: 'paid',
      confirmed_by: shop.cashier.employeeId,
      confirmation_mode: 'manual',
    });
    const [entry] = await env.handle.db
      .select()
      .from(auditLogs)
      .where(
        and(
          eq(auditLogs.outletId, shop.seeded.outletId),
          eq(auditLogs.action, 'payment.qris_manual_confirmed'),
        ),
      );
    expect(entry).toMatchObject({ entityId: payment.id, actorId: shop.cashier.employeeId });
    // Now the sale counts, as a manually confirmed QRIS payment.
    const summary = json<{ total_qris_sales: number; qris_manual_confirmed_count: number }>(
      await get(env, `/v1/shifts/${shop.shiftId}/summary`, shop.cashier.headers),
    );
    expect(summary).toMatchObject({ total_qris_sales: 30_000, qris_manual_confirmed_count: 1 });
  });

  it('is idempotent and writes one audit entry however often it is confirmed', async () => {
    const shop = await createShop(env);
    const { payment } = await qrisSale(shop);
    const results = await Promise.all([1, 2, 3].map(() => confirm(shop, payment.id)));
    expect(results.map((r) => r.statusCode)).toEqual([200, 200, 200]);
    expect(
      (await auditActions(shop)).filter((a) => a === 'payment.qris_manual_confirmed'),
    ).toHaveLength(1);
  });

  it('lets another cashier of the outlet confirm', async () => {
    const shop = await createShop(env);
    const budi = await cashierSession(
      env,
      shop.seeded,
      { token: shop.ownerToken },
      shop.device,
      'Budi',
    );
    const { payment } = await qrisSale(shop);
    const res = await confirm(shop, payment.id, budi.headers);
    expect(json<TxDto>(res).payments[0]?.confirmed_by).toBe(budi.employeeId);
  });

  it('refuses cash payments and unknown or foreign payments', async () => {
    const shop = await createShop(env);
    const other = await createShop(env);
    const cash = json<TxDto>(
      await post(env, '/v1/transactions', shop.cashier.headers, txBody(env, shop)),
    );
    const cashRes = await confirm(shop, cash.payments[0]?.id ?? '');
    expect(cashRes.statusCode).toBe(409);
    expect(json(cashRes)).toMatchObject({ code: 'CONFIRMATION_NOT_ALLOWED' });

    const { payment } = await qrisSale(shop);
    expect((await confirm(other, payment.id, other.cashier.headers)).statusCode).toBe(404);
    expect((await confirm(shop, '019a0000-0000-7000-8000-000000000001')).statusCode).toBe(404);
    expect((await confirm(shop, payment.id, bearer(shop.ownerToken))).statusCode).toBe(403);
  });

  it('refuses to confirm an auto-confirmed (gateway) payment', async () => {
    const shop = await createShop(env);
    const { payment } = await qrisSale(shop);
    await env.handle.db
      .update(payments)
      .set({ confirmationMode: 'auto' })
      .where(eq(payments.id, payment.id));
    const res = await confirm(shop, payment.id);
    expect(res.statusCode).toBe(409);
    expect(json(res)).toMatchObject({ code: 'CONFIRMATION_NOT_ALLOWED' });
  });
});

describe('cancel', () => {
  it('cancels a pending payment and its transaction, and unblocks closing the shift', async () => {
    const shop = await createShop(env);
    const { tx, payment } = await qrisSale(shop);
    const blocked = await post(env, `/v1/shifts/${shop.shiftId}/close`, shop.cashier.headers, {
      actual_cash: 100_000,
      closed_at: env.clock.now.toISOString(),
    });
    expect(json(blocked)).toMatchObject({ code: 'PENDING_QRIS_EXISTS' });

    const res = await cancel(shop, payment.id);
    expect(res.statusCode).toBe(200);
    expect(json<TxDto>(res)).toMatchObject({ id: tx.id, status: 'cancelled' });
    expect(json<TxDto>(res).payments[0]?.status).toBe('cancelled');
    expect((await cancel(shop, payment.id)).statusCode).toBe(200); // idempotent
    const closed = await post(env, `/v1/shifts/${shop.shiftId}/close`, shop.cashier.headers, {
      actual_cash: 100_000,
      closed_at: env.clock.now.toISOString(),
    });
    expect(closed.statusCode).toBe(200);
  });

  it('cannot cancel a paid payment, nor confirm a cancelled one', async () => {
    const shop = await createShop(env);
    const paid = await qrisSale(shop);
    await confirm(shop, paid.payment.id);
    const late = await cancel(shop, paid.payment.id);
    expect(late.statusCode).toBe(409);
    expect(json(late)).toMatchObject({ code: 'PAYMENT_NOT_PENDING' });

    const gone = await qrisSale(shop);
    await cancel(shop, gone.payment.id);
    const res = await confirm(shop, gone.payment.id);
    expect(res.statusCode).toBe(409);
    expect(json(res)).toMatchObject({ code: 'PAYMENT_NOT_PENDING' });
  });

  it('cannot cancel a cash payment', async () => {
    const shop = await createShop(env);
    const cash = json<TxDto>(
      await post(env, '/v1/transactions', shop.cashier.headers, txBody(env, shop)),
    );
    const res = await cancel(shop, cash.payments[0]?.id ?? '');
    expect(res.statusCode).toBe(409);
  });
});

describe('expiry after 15 minutes', () => {
  it('the job turns overdue pending payments into expired / cancelled', async () => {
    const shop = await createShop(env);
    const due = await qrisSale(shop);
    env.clock.advance(14 * 60_000);
    const still = await qrisSale(shop);
    env.clock.advance(61_000); // first one is now 15:01 old, the second 1:01

    const expired = await env.app.payments.expireDue();
    expect(expired).toBeGreaterThanOrEqual(1);

    const [dueTx] = await env.handle.db
      .select()
      .from(transactions)
      .where(eq(transactions.id, due.tx.id));
    const [duePay] = await env.handle.db
      .select()
      .from(payments)
      .where(eq(payments.id, due.payment.id));
    expect(dueTx?.status).toBe('cancelled');
    expect(duePay?.status).toBe('expired');
    const [stillTx] = await env.handle.db
      .select()
      .from(transactions)
      .where(eq(transactions.id, still.tx.id));
    expect(stillTx?.status).toBe('pending');
    expect(await auditActions(shop)).toContain('payment.qris_expired');
    // Running again finds nothing new for this outlet's payment.
    await env.app.payments.expireDue();
    const [again] = await env.handle.db
      .select()
      .from(payments)
      .where(eq(payments.id, due.payment.id));
    expect(again?.status).toBe('expired');
  });

  it('expires lazily when the payment is read after its deadline', async () => {
    const shop = await createShop(env);
    const { tx, payment } = await qrisSale(shop);
    env.clock.advance(15 * 60_000);
    const polled = json<PaymentDto>(
      await get(env, `/v1/payments/${payment.id}`, shop.cashier.headers),
    );
    expect(polled.status).toBe('expired');
    const detail = json<TxDto>(await get(env, `/v1/transactions/${tx.id}`, shop.cashier.headers));
    expect(detail.status).toBe('cancelled');
  });

  it('refuses a late confirmation and leaves the transaction cancelled', async () => {
    const shop = await createShop(env);
    const { tx, payment } = await qrisSale(shop);
    env.clock.advance(16 * 60_000);
    const res = await confirm(shop, payment.id);
    expect(res.statusCode).toBe(409);
    expect(json(res)).toMatchObject({ code: 'PAYMENT_NOT_PENDING' });
    const detail = json<TxDto>(await get(env, `/v1/transactions/${tx.id}`, shop.cashier.headers));
    expect(detail.status).toBe('cancelled');
    // The cancelled transaction no longer blocks closing the shift.
    const closed = await post(env, `/v1/shifts/${shop.shiftId}/close`, shop.cashier.headers, {
      actual_cash: 100_000,
      closed_at: env.clock.now.toISOString(),
    });
    expect(closed.statusCode).toBe(200);
  });

  it('only one concurrent run expires a payment (advisory lock / skip locked)', async () => {
    const shop = await createShop(env);
    const { payment } = await qrisSale(shop);
    env.clock.advance(20 * 60_000);
    await Promise.all([
      env.app.payments.expireDue(),
      env.app.payments.expireDue(),
      env.app.payments.expireDue(),
    ]);
    const trail = (await auditActions(shop)).filter((a) => a === 'payment.qris_expired');
    expect(trail).toHaveLength(1);
    const [row] = await env.handle.db.select().from(payments).where(eq(payments.id, payment.id));
    expect(row?.status).toBe('expired');
  });
});

describe('GET /payments/{id}', () => {
  it('is readable by the owner and the cashier of the outlet only', async () => {
    const shop = await createShop(env);
    const other = await createShop(env);
    const { payment } = await qrisSale(shop);
    expect((await get(env, `/v1/payments/${payment.id}`, bearer(shop.ownerToken))).statusCode).toBe(
      200,
    );
    expect((await get(env, `/v1/payments/${payment.id}`, shop.cashier.headers)).statusCode).toBe(
      200,
    );
    expect((await get(env, `/v1/payments/${payment.id}`, other.cashier.headers)).statusCode).toBe(
      404,
    );
    expect((await get(env, `/v1/payments/${payment.id}`, {})).statusCode).toBe(401);
  });
});

describe('StaticQrisProvider', () => {
  it('returns the stored payload unchanged unless the amount is embedded', async () => {
    const payload = buildQris();
    const plain = new StaticQrisProvider({ payload, embedAmount: false });
    const charge = await plain.createCharge({
      paymentId: 'p',
      transactionNumber: 'n',
      amount: 1000,
      expiresInSec: 900,
      now: new Date('2026-10-26T00:00:00Z'),
    });
    expect(charge.qrPayload).toBe(payload);
    expect(charge.expiresAt.toISOString()).toBe('2026-10-26T00:15:00.000Z');
    expect(plain.confirmationMode).toBe('manual');
    await expect(plain.getStatus()).resolves.toBe('pending');
    await expect(plain.cancel()).resolves.toBeUndefined();
  });

  it('reports an unusable stored payload as provider unavailable', async () => {
    const broken = new StaticQrisProvider({ payload: 'broken', embedAmount: true });
    await expect(
      broken.createCharge({
        paymentId: 'p',
        transactionNumber: 'n',
        amount: 1000,
        expiresInSec: 900,
        now: new Date(),
      }),
    ).rejects.toMatchObject({ code: 'QRIS_PROVIDER_UNAVAILABLE', status: 503 });
  });
});

describe('auto-confirmation providers (phase 2 path)', () => {
  async function autoPayment(shop: Shop) {
    const sale = await qrisSale(shop);
    await env.handle.db
      .update(payments)
      .set({ confirmationMode: 'auto' })
      .where(eq(payments.id, sale.payment.id));
    return sale;
  }

  it('polling a paid provider status marks payment and transaction paid', async () => {
    const shop = await createShop(env);
    const { tx, payment } = await autoPayment(shop);
    const spy = vi
      .spyOn(StaticQrisProvider.prototype, 'getStatus')
      .mockResolvedValue('paid' as never);
    try {
      const polled = json<PaymentDto>(
        await get(env, `/v1/payments/${payment.id}`, shop.cashier.headers),
      );
      expect(polled).toMatchObject({
        status: 'paid',
        confirmed_by: null,
        confirmation_mode: 'auto',
      });
      const detail = json<TxDto>(await get(env, `/v1/transactions/${tx.id}`, shop.cashier.headers));
      expect(detail.status).toBe('paid');
    } finally {
      spy.mockRestore();
    }
  });

  it('polling a failed provider status cancels the sale', async () => {
    const shop = await createShop(env);
    const { tx, payment } = await autoPayment(shop);
    const spy = vi
      .spyOn(StaticQrisProvider.prototype, 'getStatus')
      .mockResolvedValue('failed' as never);
    try {
      const polled = json<PaymentDto>(
        await get(env, `/v1/payments/${payment.id}`, shop.cashier.headers),
      );
      expect(polled.status).toBe('expired');
      const detail = json<TxDto>(await get(env, `/v1/transactions/${tx.id}`, shop.cashier.headers));
      expect(detail.status).toBe('cancelled');
    } finally {
      spy.mockRestore();
    }
  });

  it('keeps a still-pending payment pending', async () => {
    const shop = await createShop(env);
    const { payment } = await autoPayment(shop);
    const polled = json<PaymentDto>(
      await get(env, `/v1/payments/${payment.id}`, shop.cashier.headers),
    );
    expect(polled.status).toBe('pending');
  });
});

describe('expiry job scheduling', () => {
  it('runs the service on every tick, never overlapping, and logs failures', async () => {
    vi.useFakeTimers();
    try {
      let calls = 0;
      let release: (() => void) | undefined;
      const service = {
        expireDue: () => {
          calls += 1;
          if (calls === 1) return Promise.resolve(2);
          if (calls === 2) return new Promise<number>((resolve) => (release = () => resolve(0)));
          return Promise.reject(new Error('db down'));
        },
      } as unknown as Parameters<typeof startExpiryJob>[0];
      const log = { info: vi.fn(), error: vi.fn() };
      const stop = startExpiryJob(service, log, 1000);

      await vi.advanceTimersByTimeAsync(1000); // call 1 -> expired 2
      expect(log.info).toHaveBeenCalledWith({ expired: 2 }, expect.any(String));
      await vi.advanceTimersByTimeAsync(1000); // call 2 starts and hangs
      await vi.advanceTimersByTimeAsync(3000); // ticks while running are skipped
      expect(calls).toBe(2);
      release?.();
      await vi.advanceTimersByTimeAsync(1000); // call 3 fails
      expect(calls).toBe(3);
      expect(log.error).toHaveBeenCalledTimes(1);
      stop();
      await vi.advanceTimersByTimeAsync(5000);
      expect(calls).toBe(3);
    } finally {
      vi.useRealTimers();
    }
  });
});
