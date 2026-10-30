/**
 * API contract types for Kelola Kasir, generated from `docs/api/openapi.yaml` (design-first, ADR-0001).
 * Change the OpenAPI file first, then run `pnpm contracts:generate`.
 */
import type { components, operations, paths } from './generated/openapi.js';

export type { components, operations, paths };

export type Schemas = components['schemas'];

export type Product = Schemas['Product'];
export type ProductInput = Schemas['ProductInput'];
export type Category = Schemas['Category'];
export type Catalog = Schemas['Catalog'];
export type Employee = Schemas['Employee'];
export type Device = Schemas['Device'];
export type Shift = Schemas['Shift'];
export type ShiftSummary = Schemas['ShiftSummary'];
export type ShiftStatus = Schemas['ShiftStatus'];
export type Transaction = Schemas['Transaction'];
export type TransactionSummary = Schemas['TransactionSummary'];
export type TransactionCreate = Schemas['TransactionCreate'];
export type TransactionItemInput = Schemas['TransactionItemInput'];
export type TransactionStatus = Schemas['TransactionStatus'];
export type PaymentMethod = Schemas['PaymentMethod'];
export type Payment = Schemas['Payment'];
export type Receipt = Schemas['Receipt'];
export type VoidRequest = Schemas['VoidRequest'];
export type SyncMutation = Schemas['SyncMutation'];
export type SyncPullResponse = Schemas['SyncPullResponse'];
export type OutletSettings = Schemas['OutletSettings'];
export type Problem = Schemas['Problem'];
export type NotificationPrefs = Schemas['NotificationPrefs'];
export type NotificationPrefsInput = Schemas['NotificationPrefsInput'];
export type PushConfig = Schemas['PushConfig'];
export type PushSubscription = Schemas['PushSubscription'];
export type PushSubscriptionInput = Schemas['PushSubscriptionInput'];
export type PushSubscriptionStatus = Schemas['PushSubscriptionStatus'];
export type ProductImportPreview = Schemas['ProductImportPreview'];
export type ProductImportRow = Schemas['ProductImportRow'];
export type ProductImportRowError = Schemas['ProductImportRowError'];
export type ProductImportRowErrorCode = Schemas['ProductImportRowErrorCode'];
export type ProductImportAction = Schemas['ProductImportAction'];
export type ProductImportColumn = Schemas['ProductImportColumn'];
export type ProductImportResult = Schemas['ProductImportResult'];

/** JSON body of a successful response for `path` + `method`. */
export type ResponseBody<
  P extends keyof paths,
  M extends keyof paths[P],
  S extends number = 200,
> = paths[P][M] extends { responses: infer R }
  ? S extends keyof R
    ? R[S] extends { content: { 'application/json': infer B } }
      ? B
      : never
    : never
  : never;

export const TRANSACTION_STATUSES = [
  'pending',
  'paid',
  'void_requested',
  'voided',
  'cancelled',
] as const satisfies readonly TransactionStatus[];

export const PAYMENT_METHODS = ['cash', 'qris'] as const satisfies readonly PaymentMethod[];

export const SHIFT_STATUSES = ['open', 'closed'] as const satisfies readonly ShiftStatus[];

export const PRODUCT_IMPORT_COLUMNS = [
  'nama',
  'kategori',
  'harga',
  'favorit',
  'aktif',
] as const satisfies readonly ProductImportColumn[];

/** Import file limits (ADR-0018); the API enforces them, the dashboard checks them before uploading. */
export const PRODUCT_IMPORT_LIMITS = { maxBytes: 2 * 1024 * 1024, maxRows: 500 } as const;
