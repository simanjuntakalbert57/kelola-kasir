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
export type Principal = Schemas['Principal'];
export type TransactionDeleteInput = Schemas['TransactionDeleteInput'];
export type TransactionRestoreInput = Schemas['TransactionRestoreInput'];
export type TransactionDeleted = Schemas['TransactionDeleted'];
export type TransactionDeletionEvent = Schemas['TransactionDeletionEvent'];
export type DeletedTransactionSummary = Schemas['DeletedTransactionSummary'];
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
export type OwnerSession = Schemas['OwnerSession'];
export type OwnerOutletRef = Schemas['OwnerOutletRef'];
export type ExpenseGroup = Schemas['ExpenseGroup'];
export type ExpenseFundingSource = Schemas['ExpenseFundingSource'];
export type ExpenseCategory = Schemas['ExpenseCategory'];
export type ExpenseCategoryInput = Schemas['ExpenseCategoryInput'];
export type ExpenseCategoryUpdate = Schemas['ExpenseCategoryUpdate'];
export type Expense = Schemas['Expense'];
export type ExpenseDetail = Schemas['ExpenseDetail'];
export type ExpenseInput = Schemas['ExpenseInput'];
export type ExpenseUpdate = Schemas['ExpenseUpdate'];
export type ExpenseDeleteInput = Schemas['ExpenseDeleteInput'];
export type ExpenseHistoryEvent = Schemas['ExpenseHistoryEvent'];
export type ExpenseReport = Schemas['ExpenseReport'];
export type ExpenseReportCell = Schemas['ExpenseReportCell'];
export type OutletScope = NonNullable<
  operations['getExpenseReport']['parameters']['query']
>['outlet_scope'];

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

/** Statuses the owner may delete (ADR-0019); `pending` and `void_requested` must be settled first. */
export const DELETABLE_TRANSACTION_STATUSES = [
  'paid',
  'voided',
  'cancelled',
] as const satisfies readonly TransactionStatus[];

/** Delete reason length after trimming (ADR-0019); the API enforces it, the dashboard checks it first. */
export const TRANSACTION_DELETE_REASON = { min: 5, max: 200 } as const;

/** Optional restore note length after trimming (OpenAPI `TransactionRestoreInput.note`). */
export const TRANSACTION_RESTORE_NOTE = { max: 200 } as const;

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

/** "Semua cabang" aggregates the outlets where the caller is owner (ADR-0020). */
export const OUTLET_SCOPES = [
  'current',
  'all',
] as const satisfies readonly NonNullable<OutletScope>[];

/** Expense groups in report order (ADR-0021), with the dashboard labels. */
export const EXPENSE_GROUPS = [
  'hpp',
  'operasional',
  'tetap',
  'lainnya',
] as const satisfies readonly ExpenseGroup[];

export const EXPENSE_GROUP_LABELS = {
  hpp: 'Bahan jus (HPP)',
  operasional: 'Operasional',
  tetap: 'Tetap',
  lainnya: 'Lainnya',
} as const satisfies Record<ExpenseGroup, string>;

export const EXPENSE_FUNDING_SOURCES = [
  'drawer',
  'owner',
] as const satisfies readonly ExpenseFundingSource[];

export const EXPENSE_FUNDING_SOURCE_LABELS = {
  drawer: 'Kas laci cabang',
  owner: 'Uang owner (transfer/pribadi)',
} as const satisfies Record<ExpenseFundingSource, string>;

/** Expense input limits (ADR-0021); the API enforces them, the dashboard checks them first. Lengths after trimming. */
export const EXPENSE_LIMITS = {
  descriptionMax: 200,
  categoryNameMax: 40,
  amountMin: 1,
  amountMax: 1_000_000_000,
  earliestSpentOn: '2020-01-01',
  /** Server limit of a receipt upload; the dashboard compresses to `receiptTargetBytes` first. */
  receiptMaxBytes: 300 * 1024,
  receiptTargetBytes: 200 * 1000,
} as const;

/** Expense delete reason length after trimming, same rule as transactions (ADR-0019). */
export const EXPENSE_DELETE_REASON = TRANSACTION_DELETE_REASON;

/** At most this many months per expense report request. */
export const EXPENSE_REPORT_MAX_MONTHS = 12;
