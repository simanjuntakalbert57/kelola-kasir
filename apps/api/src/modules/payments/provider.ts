import { errors } from '../../errors.js';
import { embedAmount, QrisError } from '../../lib/qris.js';
import type { payments } from '../../db/schema.js';
import type { SettingsRow } from '../settings/serialize.js';

export type PaymentRow = typeof payments.$inferSelect;

export interface ChargeInput {
  paymentId: string;
  transactionNumber: string;
  amount: number;
  expiresInSec: number;
  now: Date;
}

export interface Charge {
  qrPayload: string;
  qrImageUrl?: string;
  providerRef?: string;
  expiresAt: Date;
}

/** ADR-0007: the cashier flow is identical for every provider; only `confirmationMode` differs. */
export interface PaymentProvider {
  readonly name: 'qris_static' | 'midtrans' | 'xendit';
  readonly confirmationMode: 'manual' | 'auto';
  createCharge(input: ChargeInput): Promise<Charge>;
  getStatus(payment: PaymentRow): Promise<'pending' | 'paid' | 'expired' | 'failed'>;
  cancel(payment: PaymentRow): Promise<void>;
}

export interface StaticQrisOptions {
  /** The shop's static QRIS payload (validated when stored in the settings). */
  payload: string;
  /** Insert the amount (EMVCo tag 54) so buyers need not type it; the CRC is recomputed. */
  embedAmount: boolean;
  imageUrl?: string | null;
}

/** Static shop QRIS with manual confirmation by the cashier (MVP). */
export class StaticQrisProvider implements PaymentProvider {
  readonly name = 'qris_static';
  readonly confirmationMode = 'manual';

  constructor(private readonly options: StaticQrisOptions) {}

  createCharge(input: ChargeInput): Promise<Charge> {
    let qrPayload = this.options.payload;
    if (this.options.embedAmount) {
      try {
        qrPayload = embedAmount(this.options.payload, input.amount);
      } catch (err) {
        if (!(err instanceof QrisError)) throw err;
        return Promise.reject(
          errors.unavailable(
            'QRIS_PROVIDER_UNAVAILABLE',
            'QRIS is unavailable',
            'The stored QRIS payload cannot carry an amount; update it in the store settings',
          ),
        );
      }
    }
    return Promise.resolve({
      qrPayload,
      ...(this.options.imageUrl ? { qrImageUrl: this.options.imageUrl } : {}),
      expiresAt: new Date(input.now.getTime() + input.expiresInSec * 1000),
    });
  }

  /** Nothing can be observed for a static QR: the cashier confirms by hand. */
  getStatus(): Promise<'pending'> {
    return Promise.resolve('pending');
  }

  cancel(): Promise<void> {
    return Promise.resolve();
  }
}

/** Provider of an outlet, from `outlet_settings.qris_mode` (TDD §5.1). */
export function resolveProvider(settings: SettingsRow): PaymentProvider {
  if (settings.qrisMode === 'static') {
    if (!settings.qrisStaticPayload) {
      throw errors.unavailable(
        'QRIS_PROVIDER_UNAVAILABLE',
        'QRIS is unavailable',
        'The store has no QRIS payload yet; the owner must set it in the store settings',
      );
    }
    return new StaticQrisProvider({
      payload: settings.qrisStaticPayload,
      embedAmount: settings.qrisEmbedAmount,
      imageUrl: settings.qrisStaticImageUrl,
    });
  }
  throw errors.unavailable(
    'QRIS_PROVIDER_UNAVAILABLE',
    'QRIS is unavailable',
    'Dynamic QRIS is not available yet; switch the store to static QRIS',
  );
}
