import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgSequence,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

/**
 * Data model of TDD §3. Money columns are integer Rupiah (`BIGINT`, mapped to JS `number`;
 * Rupiah amounts stay far below 2^53). Triggers that cannot be expressed here (updated_seq,
 * transaction immutability, append-only audit log) live in `drizzle/*_triggers.sql`.
 */

const money = (name: string) => bigint(name, { mode: 'number' });
const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });
const createdAt = () => ts('created_at').notNull().defaultNow();

/** Global sequence behind `updated_seq`, the cursor of `/sync/pull` (ADR-0008). */
export const catalogSeq = pgSequence('catalog_seq');
const updatedSeq = () =>
  bigint('updated_seq', { mode: 'number' })
    .notNull()
    .default(sql`nextval('catalog_seq')`);

export const outlets = pgTable('outlets', {
  id: uuid('id').primaryKey().defaultRandom(),
  code: text('code').notNull().unique(),
  name: text('name').notNull(),
  timezone: text('timezone').notNull().default('Asia/Jakarta'),
  /** Counter behind device codes (K01, K02, ...). */
  deviceSeq: integer('device_seq').notNull().default(0),
  createdAt: createdAt(),
});

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  /** Stored lower-cased. */
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  name: text('name').notNull(),
  ownerPinHash: text('owner_pin_hash'),
  isActive: boolean('is_active').notNull().default(true),
  failedLoginCount: integer('failed_login_count').notNull().default(0),
  lockedUntil: ts('locked_until'),
  createdAt: createdAt(),
});

export const outletMembers = pgTable(
  'outlet_members',
  {
    outletId: uuid('outlet_id')
      .notNull()
      .references(() => outlets.id),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    role: text('role').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.outletId, t.userId] }),
    check('outlet_members_role_check', sql`${t.role} IN ('owner', 'manager')`),
  ],
);

export const outletSettings = pgTable('outlet_settings', {
  outletId: uuid('outlet_id')
    .primaryKey()
    .references(() => outlets.id),
  displayName: text('display_name').notNull(),
  address: text('address'),
  phone: text('phone'),
  logoUrl: text('logo_url'),
  receiptHeader: text('receipt_header'),
  receiptFooter: text('receipt_footer'),
  qrisMode: text('qris_mode').notNull().default('static'),
  qrisStaticPayload: text('qris_static_payload'),
  qrisStaticImageUrl: text('qris_static_image_url'),
  qrisMerchantName: text('qris_merchant_name'),
  qrisEmbedAmount: boolean('qris_embed_amount').notNull().default(false),
  offlineLoginEnabled: boolean('offline_login_enabled').notNull().default(false),
  quickCashAmounts: jsonb('quick_cash_amounts')
    .$type<number[]>()
    .notNull()
    .default(sql`'[20000, 50000, 100000]'::jsonb`),
  updatedSeq: updatedSeq(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
});

export const employees = pgTable(
  'employees',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    outletId: uuid('outlet_id')
      .notNull()
      .references(() => outlets.id),
    name: text('name').notNull(),
    /** argon2id hash of the 6-digit PIN. */
    pinHash: text('pin_hash').notNull(),
    /** HMAC-SHA256(secret, outlet_id:pin): deterministic, so PINs can be unique per outlet. */
    pinFingerprint: text('pin_fingerprint').notNull(),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: createdAt(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
    updatedSeq: updatedSeq(),
  },
  (t) => [
    uniqueIndex('employees_pin_unique_per_outlet')
      .on(t.outletId, t.pinFingerprint)
      .where(sql`${t.isActive}`),
    index('employees_outlet_idx').on(t.outletId, t.updatedSeq),
  ],
);

export const devices = pgTable(
  'devices',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    outletId: uuid('outlet_id')
      .notNull()
      .references(() => outlets.id),
    /** Short code used in transaction numbers, e.g. K01. */
    code: text('code').notNull(),
    name: text('name').notNull(),
    /** SHA-256 (hex) of the opaque device token; null until paired. */
    tokenHash: text('token_hash').unique(),
    pairedAt: ts('paired_at'),
    revokedAt: ts('revoked_at'),
    lastSeenAt: ts('last_seen_at'),
    appVersion: text('app_version'),
    platform: text('platform'),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('devices_outlet_code_unique').on(t.outletId, t.code)],
);

export const devicePairingCodes = pgTable('device_pairing_codes', {
  id: uuid('id').primaryKey().defaultRandom(),
  deviceId: uuid('device_id')
    .notNull()
    .references(() => devices.id),
  /** SHA-256 (hex) of the pairing code. */
  codeHash: text('code_hash').notNull().unique(),
  expiresAt: ts('expires_at').notNull(),
  usedAt: ts('used_at'),
  createdAt: createdAt(),
});

/** Employee sessions (`jti` of the access token), so PIN logout and revocation take effect at once. */
export const employeeSessions = pgTable(
  'employee_sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    employeeId: uuid('employee_id')
      .notNull()
      .references(() => employees.id),
    deviceId: uuid('device_id')
      .notNull()
      .references(() => devices.id),
    createdAt: createdAt(),
    expiresAt: ts('expires_at').notNull(),
    revokedAt: ts('revoked_at'),
  },
  (t) => [index('employee_sessions_device_idx').on(t.deviceId)],
);

/** Failed PIN attempts per employee and device; 5 failures lock the employee on that device. */
export const employeePinAttempts = pgTable(
  'employee_pin_attempts',
  {
    employeeId: uuid('employee_id')
      .notNull()
      .references(() => employees.id),
    deviceId: uuid('device_id')
      .notNull()
      .references(() => devices.id),
    failedCount: integer('failed_count').notNull().default(0),
    lockedUntil: ts('locked_until'),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.employeeId, t.deviceId] })],
);

export const refreshTokens = pgTable(
  'refresh_tokens',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    /** All tokens of one login chain share a family; reuse of a rotated token revokes the family. */
    familyId: uuid('family_id').notNull(),
    tokenHash: text('token_hash').notNull().unique(),
    createdAt: createdAt(),
    expiresAt: ts('expires_at').notNull(),
    usedAt: ts('used_at'),
    revokedAt: ts('revoked_at'),
  },
  (t) => [index('refresh_tokens_family_idx').on(t.familyId)],
);

export const categories = pgTable(
  'categories',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    outletId: uuid('outlet_id')
      .notNull()
      .references(() => outlets.id),
    name: text('name').notNull(),
    sortOrder: integer('sort_order').notNull().default(0),
    deletedAt: ts('deleted_at'),
    createdAt: createdAt(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
    updatedSeq: updatedSeq(),
  },
  (t) => [index('categories_outlet_seq_idx').on(t.outletId, t.updatedSeq)],
);

export const products = pgTable(
  'products',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    outletId: uuid('outlet_id')
      .notNull()
      .references(() => outlets.id),
    categoryId: uuid('category_id')
      .notNull()
      .references(() => categories.id),
    name: text('name').notNull(),
    imageUrl: text('image_url'),
    /** The single selling price (Rupiah); products have no variants. */
    price: money('price').notNull(),
    isActive: boolean('is_active').notNull().default(true),
    isSoldOut: boolean('is_sold_out').notNull().default(false),
    sortOrder: integer('sort_order').notNull().default(0),
    deletedAt: ts('deleted_at'),
    createdAt: createdAt(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
    updatedSeq: updatedSeq(),
  },
  (t) => [
    index('products_outlet_seq_idx').on(t.outletId, t.updatedSeq),
    check('products_price_check', sql`${t.price} >= 0`),
  ],
);

export const shifts = pgTable(
  'shifts',
  {
    /** UUIDv7 generated by the cashier app. */
    id: uuid('id').primaryKey(),
    outletId: uuid('outlet_id')
      .notNull()
      .references(() => outlets.id),
    openedDeviceId: uuid('opened_device_id')
      .notNull()
      .references(() => devices.id),
    closedDeviceId: uuid('closed_device_id').references(() => devices.id),
    openedBy: uuid('opened_by')
      .notNull()
      .references(() => employees.id),
    closedBy: uuid('closed_by').references(() => employees.id),
    status: text('status').notNull().default('open'),
    openingCash: money('opening_cash').notNull(),
    expectedCash: money('expected_cash'),
    actualCash: money('actual_cash'),
    cashDifference: bigint('cash_difference', { mode: 'number' }),
    totalCashSales: money('total_cash_sales'),
    totalQrisSales: money('total_qris_sales'),
    transactionCount: integer('transaction_count'),
    openedAt: ts('opened_at').notNull(),
    closedAt: ts('closed_at'),
    closingNote: text('closing_note'),
    closedOffline: boolean('closed_offline').notNull().default(false),
    unsyncedCount: integer('unsynced_count'),
    createdAt: createdAt(),
  },
  (t) => [
    // ADR-0009: at most one open shift per outlet, enforced by the database.
    uniqueIndex('shifts_one_open_per_outlet')
      .on(t.outletId)
      .where(sql`${t.status} = 'open'`),
    index('shifts_outlet_opened_idx').on(t.outletId, t.openedAt.desc()),
    check('shifts_status_check', sql`${t.status} IN ('open', 'closed')`),
    check('shifts_opening_cash_check', sql`${t.openingCash} >= 0`),
    check(
      'shifts_closed_fields_check',
      sql`(${t.status} = 'open') OR (${t.closedAt} IS NOT NULL AND ${t.actualCash} IS NOT NULL AND ${t.closedBy} IS NOT NULL)`,
    ),
  ],
);

export const transactions = pgTable(
  'transactions',
  {
    /** UUIDv7 generated by the cashier app. */
    id: uuid('id').primaryKey(),
    outletId: uuid('outlet_id')
      .notNull()
      .references(() => outlets.id),
    shiftId: uuid('shift_id')
      .notNull()
      .references(() => shifts.id),
    deviceId: uuid('device_id')
      .notNull()
      .references(() => devices.id),
    /** Cashier who was logged in when the transaction was created. */
    employeeId: uuid('employee_id')
      .notNull()
      .references(() => employees.id),
    /** `{OUTLET}-{DEV}-{YYMMDD}-{seq4}`, e.g. JUS1-K01-261026-0042. */
    number: text('number').notNull(),
    status: text('status').notNull(),
    paymentMethod: text('payment_method').notNull(),
    customerLabel: text('customer_label'),
    subtotal: money('subtotal').notNull(),
    discountAmount: money('discount_amount').notNull().default(0),
    taxAmount: money('tax_amount').notNull().default(0),
    total: money('total').notNull(),
    priceMismatch: boolean('price_mismatch').notNull().default(false),
    afterShiftClose: boolean('after_shift_close').notNull().default(false),
    clientCreatedAt: ts('client_created_at').notNull(),
    serverReceivedAt: ts('server_received_at').notNull().defaultNow(),
    paidAt: ts('paid_at'),
    voidedAt: ts('voided_at'),
  },
  (t) => [
    uniqueIndex('transactions_outlet_number_unique').on(t.outletId, t.number),
    index('transactions_outlet_created_idx').on(t.outletId, t.clientCreatedAt.desc()),
    index('transactions_shift_idx').on(t.shiftId),
    index('transactions_outlet_status_idx').on(t.outletId, t.status),
    index('transactions_outlet_employee_idx').on(t.outletId, t.employeeId, t.clientCreatedAt),
    check(
      'transactions_status_check',
      sql`${t.status} IN ('pending', 'paid', 'void_requested', 'voided', 'cancelled')`,
    ),
    check('transactions_method_check', sql`${t.paymentMethod} IN ('cash', 'qris')`),
    check(
      'transactions_amounts_check',
      sql`${t.subtotal} >= 0 AND ${t.discountAmount} >= 0 AND ${t.taxAmount} >= 0 AND ${t.total} >= 0 AND ${t.total} = ${t.subtotal} - ${t.discountAmount} + ${t.taxAmount}`,
    ),
  ],
);

export const transactionItems = pgTable(
  'transaction_items',
  {
    id: uuid('id').primaryKey(),
    transactionId: uuid('transaction_id')
      .notNull()
      .references(() => transactions.id),
    /** Reference only; may be null if the product is ever removed. */
    productId: uuid('product_id').references(() => products.id, { onDelete: 'set null' }),
    /** Snapshot of the product name at sale time. */
    productName: text('product_name').notNull(),
    /** Snapshot of the product price at sale time. */
    unitPrice: money('unit_price').notNull(),
    quantity: integer('quantity').notNull(),
    lineTotal: money('line_total').notNull(),
    note: text('note'),
  },
  (t) => [
    index('transaction_items_transaction_idx').on(t.transactionId),
    check('transaction_items_quantity_check', sql`${t.quantity} BETWEEN 1 AND 999`),
    check(
      'transaction_items_amounts_check',
      sql`${t.unitPrice} >= 0 AND ${t.lineTotal} = ${t.unitPrice} * ${t.quantity}`,
    ),
  ],
);

export const payments = pgTable(
  'payments',
  {
    id: uuid('id').primaryKey(),
    transactionId: uuid('transaction_id')
      .notNull()
      .references(() => transactions.id),
    method: text('method').notNull(),
    provider: text('provider').notNull(),
    status: text('status').notNull(),
    amount: money('amount').notNull(),
    cashTendered: money('cash_tendered'),
    cashChange: money('cash_change'),
    providerRef: text('provider_ref'),
    qrPayload: text('qr_payload'),
    expiresAt: ts('expires_at'),
    confirmationMode: text('confirmation_mode'),
    confirmedBy: uuid('confirmed_by').references(() => employees.id),
    paidAt: ts('paid_at'),
    providerRaw: jsonb('provider_raw'),
    createdAt: createdAt(),
  },
  (t) => [
    index('payments_transaction_idx').on(t.transactionId),
    uniqueIndex('payments_provider_ref_unique')
      .on(t.provider, t.providerRef)
      .where(sql`${t.providerRef} IS NOT NULL`),
    check('payments_method_check', sql`${t.method} IN ('cash', 'qris')`),
    check(
      'payments_provider_check',
      sql`${t.provider} IN ('cash', 'qris_static', 'midtrans', 'xendit')`,
    ),
    check(
      'payments_status_check',
      sql`${t.status} IN ('pending', 'paid', 'expired', 'failed', 'cancelled')`,
    ),
    check('payments_amount_check', sql`${t.amount} >= 0`),
  ],
);

export const voidRequests = pgTable(
  'void_requests',
  {
    id: uuid('id').primaryKey(),
    transactionId: uuid('transaction_id')
      .notNull()
      .references(() => transactions.id),
    requestedBy: uuid('requested_by')
      .notNull()
      .references(() => employees.id),
    reason: text('reason').notNull(),
    status: text('status').notNull().default('pending'),
    decidedBy: uuid('decided_by').references(() => users.id),
    decisionChannel: text('decision_channel'),
    decisionNote: text('decision_note'),
    requestedAt: ts('requested_at').notNull(),
    decidedAt: ts('decided_at'),
  },
  (t) => [
    index('void_requests_transaction_idx').on(t.transactionId),
    check('void_requests_status_check', sql`${t.status} IN ('pending', 'approved', 'rejected')`),
    check(
      'void_requests_channel_check',
      sql`${t.decisionChannel} IS NULL OR ${t.decisionChannel} IN ('dashboard', 'device_pin')`,
    ),
  ],
);

/** Append-only (enforced by trigger). */
export const auditLogs = pgTable(
  'audit_logs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    outletId: uuid('outlet_id').references(() => outlets.id),
    actorType: text('actor_type').notNull(),
    actorId: uuid('actor_id'),
    action: text('action').notNull(),
    entityType: text('entity_type').notNull(),
    entityId: uuid('entity_id'),
    before: jsonb('before'),
    after: jsonb('after'),
    meta: jsonb('meta'),
    createdAt: createdAt(),
  },
  (t) => [
    index('audit_logs_outlet_created_idx').on(t.outletId, t.createdAt.desc()),
    index('audit_logs_entity_idx').on(t.entityType, t.entityId),
    check(
      'audit_logs_actor_type_check',
      sql`${t.actorType} IN ('user', 'employee', 'device', 'system')`,
    ),
  ],
);

/** Replay protection for online endpoints that are not idempotent by client id (`Idempotency-Key`). */
export const idempotencyKeys = pgTable(
  'idempotency_keys',
  {
    scopeId: uuid('scope_id').notNull(),
    key: text('key').notNull(),
    method: text('method').notNull(),
    path: text('path').notNull(),
    requestHash: text('request_hash').notNull(),
    responseStatus: integer('response_status'),
    responseBody: jsonb('response_body'),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.scopeId, t.key] })],
);
