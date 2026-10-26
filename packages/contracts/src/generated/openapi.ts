// AUTO-GENERATED from docs/api/openapi.yaml by `pnpm contracts:generate`. Do not edit.
export interface paths {
    "/auth/login": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Owner login with email and password (O-01) */
        post: operations["ownerLogin"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/auth/refresh": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Rotate refresh token (cookie) and issue a new access token (O-01) */
        post: operations["ownerRefresh"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/auth/logout": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Revoke the current owner refresh token (O-01) */
        post: operations["ownerLogout"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/auth/pin-login": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Employee PIN login on a paired device (P-01) */
        post: operations["employeePinLogin"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/auth/pin-logout": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** End the employee session on this device (P-01) */
        post: operations["employeePinLogout"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/me": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Current principal (owner or employee) */
        get: operations["getMe"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/devices": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List devices of the outlet (P-01 support) */
        get: operations["listDevices"];
        put?: never;
        /** Register a device and get a one-time pairing code (P-01) */
        post: operations["createDevice"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/devices/pair": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Exchange a pairing code for a device token (P-01) */
        post: operations["pairDevice"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/devices/me/employees": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Active employees selectable on the PIN login screen (P-01) */
        get: operations["listDeviceEmployees"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/devices/{device_id}/revoke": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Revoke a device; all employee sessions on it become invalid */
        post: operations["revokeDevice"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/employees": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List employees (O-06) */
        get: operations["listEmployees"];
        put?: never;
        /** Add employee with a PIN (O-06) */
        post: operations["createEmployee"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/employees/{employee_id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        /** Rename or activate/deactivate an employee (O-06) */
        patch: operations["updateEmployee"];
        trace?: never;
    };
    "/employees/{employee_id}/reset-pin": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Set a new PIN for an employee (O-06). Audited. */
        post: operations["resetEmployeePin"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/catalog": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Full catalog snapshot for the cashier app (P-03)
         * @description Categories and active products (with sold-out flag). Used for first load; afterwards use `/sync/pull`.
         */
        get: operations["getCatalog"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/categories": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List categories (O-05) */
        get: operations["listCategories"];
        put?: never;
        /** Create category (O-05) */
        post: operations["createCategory"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/categories/{category_id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        /** Soft-delete category; fails if it still has products (O-05) */
        delete: operations["deleteCategory"];
        options?: never;
        head?: never;
        /** Update category (O-05) */
        patch: operations["updateCategory"];
        trace?: never;
    };
    "/products": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List products (O-04) */
        get: operations["listProducts"];
        put?: never;
        /** Create product (O-04) */
        post: operations["createProduct"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/products/{product_id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Product detail (O-04) */
        get: operations["getProduct"];
        put?: never;
        post?: never;
        /** Soft-delete product (O-04). Past transactions keep their snapshot. */
        delete: operations["deleteProduct"];
        options?: never;
        head?: never;
        /** Update product; price changes are written to the audit log (O-04) */
        patch: operations["updateProduct"];
        trace?: never;
    };
    "/products/{product_id}/availability": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        /** Mark product sold out / available (P-11, Should) */
        patch: operations["setProductAvailability"];
        trace?: never;
    };
    "/shifts": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Shift history with cash reconciliation (O-07) */
        get: operations["listShifts"];
        put?: never;
        /**
         * Open the outlet's shift with opening cash (P-02). Idempotent on `id`.
         * @description Only one shift can be open per outlet. Other employees and devices join the open shift
         *     (read it via `GET /shifts/current` or `/sync/pull`) instead of opening a new one.
         *     Opening a shift requires the device to be online so the single-open-shift rule can be enforced.
         *     Handover = close the current shift, then open a new one.
         */
        post: operations["openShift"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/shifts/current": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** The outlet's open shift, if any (P-02). Shared by all devices of the outlet. */
        get: operations["getCurrentShift"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/shifts/{shift_id}/summary": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Shift totals (cash, QRIS, expected cash, pending voids) (P-12, O-07)
         * @description Employees can only read the outlet's currently open shift or a shift they closed.
         */
        get: operations["getShiftSummary"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/shifts/{shift_id}/close": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Close shift with actual cash counted (P-12)
         * @description Any employee logged in on a paired device of the outlet may close the open shift.
         *     Closing is also allowed offline: the app queues a `shift.close` mutation for `/sync/push`
         *     after showing a strong warning. The server recomputes the summary when the close is applied.
         *     Real sales are never dropped: cash transactions from `/sync/push` that reference this shift are
         *     accepted even after it is closed; those with `client_created_at` after `closed_at` are flagged
         *     `after_shift_close` and reported separately (`late_*` fields). Online `POST /transactions` against a
         *     closed shift still returns `SHIFT_CLOSED` so the cashier opens a new shift.
         */
        post: operations["closeShift"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/transactions": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List transactions (P-09 for employees, O-03 for owner)
         * @description Employees: results are restricted to their outlet and `scope` (the open shift or today, WIB);
         *     `date_from`/`date_to`/`employee_id` are ignored. Owner: all filters apply.
         */
        get: operations["listTransactions"];
        put?: never;
        /**
         * Create a transaction with its payment (P-05..P-07). Idempotent on `id`.
         * @description - `cash`: transaction is created as `paid`; requires `cash_tendered >= total`.
         *     - `qris`: transaction is created as `pending` and a QRIS charge is created through the outlet's
         *       PaymentProvider. Response includes `payment.qr_payload` and `payment.confirmation_mode`.
         *     The server recomputes all totals from the submitted snapshot and rejects inconsistent math
         *     (`TOTAL_MISMATCH`). Snapshot prices that differ from the current catalog are accepted and flagged
         *     `price_mismatch`. The authenticated employee is recorded as the cashier of the transaction.
         */
        post: operations["createTransaction"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/transactions/export": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Export transactions as CSV or Excel (O-03) */
        get: operations["exportTransactions"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/transactions/{transaction_id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Transaction detail with items and payments (P-09, O-03) */
        get: operations["getTransaction"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/transactions/{transaction_id}/receipt": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Receipt data for digital and 58 mm thermal receipt (P-08, Must)
         * @description Used for digital receipts and reprints from the history screen. The cashier app formats
         *     ESC/POS itself from local data + cached settings, so printing also works offline;
         *     this endpoint is the online source for reprints on another device and for the dashboard preview.
         */
        get: operations["getReceipt"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/transactions/{transaction_id}/void-requests": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Request void of a paid transaction with a reason (P-10, Should)
         * @description Employee request moves status `paid` → `void_requested`. Owner call voids immediately (`voided`). Audited.
         */
        post: operations["createVoidRequest"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/payments/{payment_id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Payment status; for `auto` mode also polls the provider (P-07) */
        get: operations["getPayment"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/payments/{payment_id}/confirm": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Manually confirm a static-QRIS payment as received (P-07). Audited. */
        post: operations["confirmPayment"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/payments/{payment_id}/cancel": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Cancel a pending QRIS payment; transaction becomes `cancelled` (P-07) */
        post: operations["cancelPayment"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/webhooks/payments/{provider}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Payment gateway webhook (phase 2, dynamic QRIS)
         * @description Signature verified per provider; idempotent on provider reference.
         */
        post: operations["paymentWebhook"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/void-requests": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List void requests (O-08, Should) */
        get: operations["listVoidRequests"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/void-requests/{void_request_id}/approve": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Approve void from dashboard (O-08, Should) */
        post: operations["approveVoidRequest"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/void-requests/{void_request_id}/reject": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Reject void (O-08, Should); transaction back to `paid` */
        post: operations["rejectVoidRequest"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/void-requests/{void_request_id}/approve-with-pin": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Owner approves a void on the cashier device using the owner PIN (P-10, Should) */
        post: operations["approveVoidWithOwnerPin"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/sync/pull": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Incremental catalog/config changes since cursor (P-03, P-11, P-13) */
        get: operations["syncPull"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/sync/push": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Push queued offline mutations in order (P-13). Idempotent per mutation id. */
        post: operations["syncPush"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/dashboard/summary": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Revenue, transaction count, average ticket, cash vs QRIS (O-02)
         * @description Counts only `paid` and `void_requested` transactions. Owner only.
         */
        get: operations["getDashboardSummary"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/dashboard/sales-series": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Sales chart per hour or day, WIB (O-02) */
        get: operations["getSalesSeries"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/dashboard/top-products": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Best-selling products by quantity and revenue (O-02) */
        get: operations["getTopProducts"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/reports/sales": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Sales report grouped by product, employee, payment method or day (O-09, Should) */
        get: operations["getSalesReport"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/settings": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Store settings incl. receipt header/footer and QRIS (O-10) */
        get: operations["getSettings"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        /** Update store settings (O-10) */
        patch: operations["updateSettings"];
        trace?: never;
    };
    "/uploads": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Get a presigned upload URL for product image, logo or QRIS image (O-04, O-10) */
        post: operations["createUpload"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
}
export type webhooks = Record<string, never>;
export interface components {
    schemas: {
        /**
         * Format: int64
         * @description Integer Rupiah. 15000 = Rp15.000.
         */
        Rupiah: number;
        /**
         * Format: int64
         * @description Integer Rupiah that may be negative (e.g. cash difference).
         */
        SignedRupiah: number;
        Problem: {
            /** Format: uri */
            type: string;
            title: string;
            status: number;
            /** @example SHIFT_NOT_OPEN */
            code: string;
            detail?: string;
            errors?: {
                path?: string;
                message?: string;
            }[];
        };
        OutletRef: {
            /** Format: uuid */
            id: string;
            /** @example JUS1 */
            code: string;
            name: string;
            /** @example Asia/Jakarta */
            timezone: string;
        };
        OwnerSession: {
            access_token: string;
            /** @example 900 */
            expires_in: number;
            user: {
                /** Format: uuid */
                id: string;
                /** Format: email */
                email: string;
                name: string;
                outlets: components["schemas"]["OutletRef"][];
            };
        };
        EmployeeSession: {
            access_token: string;
            /** @example 43200 */
            expires_in: number;
            employee: components["schemas"]["Employee"];
        };
        Principal: {
            /** @enum {string} */
            type: "user" | "employee";
            /** Format: uuid */
            id: string;
            name: string;
            /** @enum {string} */
            role: "owner" | "manager" | "cashier";
            /** Format: uuid */
            outlet_id: string;
            /** Format: uuid */
            device_id?: string | null;
        };
        Device: {
            /** Format: uuid */
            id: string;
            /** @example K01 */
            code: string;
            name: string;
            /** @enum {string} */
            status: "pending_pairing" | "active" | "revoked";
            /** Format: date-time */
            paired_at?: string | null;
            /** Format: date-time */
            last_seen_at?: string | null;
            app_version?: string | null;
        };
        Employee: {
            /** Format: uuid */
            id: string;
            name: string;
            is_active: boolean;
            /** Format: date-time */
            created_at?: string;
        };
        Category: {
            /** Format: uuid */
            id: string;
            name: string;
            sort_order: number;
        };
        CategoryInput: {
            name: string;
            /** @default 0 */
            sort_order: number;
        };
        Product: {
            /** Format: uuid */
            id: string;
            /** Format: uuid */
            category_id: string;
            name: string;
            /** Format: uri */
            image_url?: string | null;
            /** @description The single selling price; products have no variants */
            price: components["schemas"]["Rupiah"];
            is_active: boolean;
            is_sold_out: boolean;
            sort_order?: number;
            /** Format: date-time */
            updated_at?: string;
        };
        ProductInput: {
            /** Format: uuid */
            category_id: string;
            name: string;
            /** Format: uri */
            image_url?: string | null;
            price: components["schemas"]["Rupiah"];
            /** @default true */
            is_active: boolean;
            /** @default 0 */
            sort_order: number;
        };
        Catalog: {
            categories: components["schemas"]["Category"][];
            products: components["schemas"]["Product"][];
            /** @description Use as `cursor` for the next `/sync/pull` */
            cursor: string;
        };
        /** @enum {string} */
        ShiftStatus: "open" | "closed";
        Shift: {
            /** Format: uuid */
            id: string;
            /**
             * Format: uuid
             * @description Device where the shift was opened; all devices of the outlet share it
             */
            opened_on_device_id: string;
            /** Format: uuid */
            closed_on_device_id?: string | null;
            opened_by: components["schemas"]["Employee"];
            closed_by?: components["schemas"]["Employee"] | null;
            status: components["schemas"]["ShiftStatus"];
            opening_cash: components["schemas"]["Rupiah"];
            expected_cash?: components["schemas"]["Rupiah"] | null;
            actual_cash?: components["schemas"]["Rupiah"] | null;
            cash_difference?: components["schemas"]["SignedRupiah"] | null;
            /** Format: date-time */
            opened_at: string;
            /** Format: date-time */
            closed_at?: string | null;
            /** @description Close was performed offline and synced later */
            closed_offline?: boolean;
        };
        ShiftSummary: {
            shift: components["schemas"]["Shift"];
            total_cash_sales: components["schemas"]["Rupiah"];
            total_qris_sales: components["schemas"]["Rupiah"];
            qris_manual_confirmed_count?: number;
            total_sales: components["schemas"]["Rupiah"];
            transaction_count: number;
            /** @description opening_cash + cash sales (paid + void_requested) */
            expected_cash: components["schemas"]["Rupiah"];
            actual_cash?: components["schemas"]["Rupiah"] | null;
            cash_difference?: components["schemas"]["SignedRupiah"] | null;
            pending_void_count: number;
            pending_void_amount: components["schemas"]["Rupiah"];
            voided_count: number;
            voided_amount: components["schemas"]["Rupiah"];
            /** @description True when the device reported queued mutations at close time */
            unsynced_hint?: boolean;
            /** @description Synced transactions created after `closed_at` (not in expected_cash) */
            late_transaction_count?: number;
            late_cash_amount?: components["schemas"]["Rupiah"];
            /** @description Per-cashier breakdown; the shift is shared but each transaction is recorded under its cashier */
            by_employee?: {
                employee: components["schemas"]["Employee"];
                transaction_count: number;
                total_cash_sales: components["schemas"]["Rupiah"];
                total_qris_sales: components["schemas"]["Rupiah"];
            }[];
        };
        /** @enum {string} */
        PaymentMethod: "cash" | "qris";
        /**
         * @description `cancelled` = pending QRIS that was cancelled by the cashier or expired after 15 minutes (decision Q-1). Terminal; excluded from all totals.
         * @enum {string}
         */
        TransactionStatus: "pending" | "paid" | "void_requested" | "voided" | "cancelled";
        TransactionItemInput: {
            /** Format: uuid */
            id: string;
            /** Format: uuid */
            product_id: string;
            /** @description Snapshot */
            product_name: string;
            /** @description Snapshot of the product price */
            unit_price: components["schemas"]["Rupiah"];
            quantity: number;
            note?: string;
            /** @description unit_price * quantity */
            line_total: components["schemas"]["Rupiah"];
        };
        CashPaymentInput: {
            /** Format: uuid */
            id: string;
            /**
             * @description discriminator enum property added by openapi-typescript
             * @enum {string}
             */
            method: "cash";
            cash_tendered: components["schemas"]["Rupiah"];
        };
        QrisPaymentInput: {
            /** Format: uuid */
            id: string;
            /**
             * @description discriminator enum property added by openapi-typescript
             * @enum {string}
             */
            method: "qris";
        };
        PaymentInput: components["schemas"]["CashPaymentInput"] | components["schemas"]["QrisPaymentInput"];
        TransactionCreate: {
            /**
             * Format: uuid
             * @description Client-generated UUIDv7
             */
            id: string;
            /** Format: uuid */
            shift_id: string;
            /** @example JUS1-K01-261026-0042 */
            number: string;
            /** Format: date-time */
            client_created_at: string;
            /** @description Optional buyer name/number */
            customer_label?: string;
            items: components["schemas"]["TransactionItemInput"][];
            subtotal: components["schemas"]["Rupiah"];
            /** @default 0 */
            discount_amount: components["schemas"]["Rupiah"];
            /** @default 0 */
            tax_amount: components["schemas"]["Rupiah"];
            total: components["schemas"]["Rupiah"];
            payment: components["schemas"]["PaymentInput"];
        };
        Payment: {
            /** Format: uuid */
            id: string;
            /** Format: uuid */
            transaction_id: string;
            method: components["schemas"]["PaymentMethod"];
            /** @enum {string} */
            provider: "cash" | "qris_static" | "midtrans" | "xendit";
            /** @enum {string} */
            status: "pending" | "paid" | "expired" | "failed" | "cancelled";
            amount: components["schemas"]["Rupiah"];
            cash_tendered?: components["schemas"]["Rupiah"] | null;
            cash_change?: components["schemas"]["Rupiah"] | null;
            /**
             * @description QRIS only
             * @enum {string|null}
             */
            confirmation_mode?: "manual" | "auto" | null;
            /** @description EMVCo QRIS string to render as QR */
            qr_payload?: string | null;
            /**
             * Format: uri
             * @description Fallback image for static QRIS
             */
            qr_image_url?: string | null;
            /** Format: date-time */
            expires_at?: string | null;
            /** Format: uuid */
            confirmed_by?: string | null;
            /** Format: date-time */
            paid_at?: string | null;
        };
        TransactionSummary: {
            /** Format: uuid */
            id: string;
            number: string;
            status: components["schemas"]["TransactionStatus"];
            payment_method: components["schemas"]["PaymentMethod"];
            total: components["schemas"]["Rupiah"];
            item_count?: number;
            customer_label?: string | null;
            employee: components["schemas"]["Employee"];
            /** Format: uuid */
            shift_id?: string;
            price_mismatch?: boolean;
            /** @description Synced after its shift was closed and created after `closed_at` */
            after_shift_close?: boolean;
            /** Format: date-time */
            client_created_at: string;
            /** Format: date-time */
            paid_at?: string | null;
        };
        Transaction: components["schemas"]["TransactionSummary"] & {
            subtotal: components["schemas"]["Rupiah"];
            discount_amount: components["schemas"]["Rupiah"];
            tax_amount: components["schemas"]["Rupiah"];
            items: {
                /** Format: uuid */
                id: string;
                /** Format: uuid */
                product_id?: string | null;
                product_name: string;
                unit_price: components["schemas"]["Rupiah"];
                quantity: number;
                line_total: components["schemas"]["Rupiah"];
                note?: string | null;
            }[];
            payments: components["schemas"]["Payment"][];
            void_request?: components["schemas"]["VoidRequest"] | null;
            /** Format: date-time */
            server_received_at?: string;
        };
        Receipt: {
            store: {
                name: string;
                address?: string | null;
                /** Format: uri */
                logo_url?: string | null;
                phone?: string | null;
                /** @description Extra header lines set by the owner */
                header?: string | null;
                /** @description Closing message set by the owner */
                footer?: string | null;
            };
            cashier_name: string;
            /**
             * @default 58
             * @enum {integer}
             */
            paper_width_mm: 58;
            transaction: components["schemas"]["Transaction"];
            /** @description Plain-text receipt (32 chars per line) for WhatsApp share and ESC/POS printing */
            share_text?: string;
        };
        VoidRequest: {
            /** Format: uuid */
            id: string;
            /** Format: uuid */
            transaction_id: string;
            transaction_number?: string;
            transaction_total?: components["schemas"]["Rupiah"];
            reason: string;
            /** @enum {string} */
            status: "pending" | "approved" | "rejected";
            requested_by: components["schemas"]["Employee"];
            /** Format: date-time */
            requested_at: string;
            /** Format: uuid */
            decided_by?: string | null;
            /** @enum {string|null} */
            decision_channel?: "dashboard" | "device_pin" | null;
            decision_note?: string | null;
            /** Format: date-time */
            decided_at?: string | null;
        };
        VoidDecision: {
            note?: string;
        };
        SyncMutation: {
            /**
             * Format: uuid
             * @description Equals the entity id (transaction/void request), or the shift id for `shift.close`
             */
            id: string;
            /** @enum {string} */
            type: "transaction.create" | "shift.close" | "void_request.create" | "product.mark_sold_out";
            /** Format: date-time */
            client_created_at: string;
            /**
             * Format: uuid
             * @description Employee who performed the action (may have logged in offline)
             */
            employee_id?: string;
            /** @description Same body as the corresponding online endpoint (`shift.close` adds `shift_id`). QRIS transactions and shift opening are never queued. */
            payload: {
                [key: string]: unknown;
            };
        };
        SyncPullResponse: {
            next_cursor: string;
            has_more: boolean;
            changes: {
                categories?: components["schemas"]["Category"][];
                products?: components["schemas"]["Product"][];
                /** @description Active employees with argon2id PIN hash for offline login (only if enabled for outlet) */
                employees?: {
                    /** Format: uuid */
                    id: string;
                    name: string;
                    is_active: boolean;
                    pin_hash?: string | null;
                }[];
                settings?: components["schemas"]["OutletSettings"] | null;
                deleted?: {
                    /** @enum {string} */
                    entity: "category" | "product" | "employee";
                    /** Format: uuid */
                    id: string;
                }[];
            };
            /** @description The outlet's open shift, so every device joins the same one */
            current_shift?: components["schemas"]["Shift"] | null;
            /** @description When true the app must wipe local credentials */
            device_revoked?: boolean;
        };
        DashboardSummary: {
            revenue: components["schemas"]["Rupiah"];
            transaction_count: number;
            /** @description Rounded down to whole Rupiah */
            average_ticket: components["schemas"]["Rupiah"];
            cash_revenue: components["schemas"]["Rupiah"];
            qris_revenue: components["schemas"]["Rupiah"];
            cash_count: number;
            qris_count: number;
            voided_count: number;
            pending_void_count?: number;
            compare_previous_period?: {
                revenue_change_pct?: number | null;
            };
        };
        OutletSettings: {
            outlet: components["schemas"]["OutletRef"];
            display_name: string;
            address?: string | null;
            phone?: string | null;
            /** Format: uri */
            logo_url?: string | null;
            /** @description Extra header lines under the store name/address, e.g. Instagram handle */
            receipt_header?: string | null;
            /** @description Closing message, e.g. "Terima kasih!" */
            receipt_footer?: string | null;
            /** @enum {string} */
            qris_mode: "static" | "dynamic";
            qris_static_payload?: string | null;
            /** Format: uri */
            qris_static_image_url?: string | null;
            qris_merchant_name?: string | null;
            /** @description Embed amount (EMVCo tag 54) into static QRIS */
            qris_embed_amount?: boolean;
            offline_login_enabled?: boolean;
            /**
             * @example [
             *       20000,
             *       50000,
             *       100000
             *     ]
             */
            quick_cash_amounts?: components["schemas"]["Rupiah"][];
        };
        OutletSettingsInput: {
            display_name?: string;
            address?: string | null;
            phone?: string | null;
            /** Format: uri */
            logo_url?: string | null;
            receipt_header?: string | null;
            receipt_footer?: string | null;
            qris_static_payload?: string | null;
            /** Format: uri */
            qris_static_image_url?: string | null;
            qris_embed_amount?: boolean;
            offline_login_enabled?: boolean;
            quick_cash_amounts?: components["schemas"]["Rupiah"][];
            /** @description Set/replace owner PIN for void approval on device */
            owner_pin?: string;
        };
    };
    responses: {
        /** @description Validation error (`VALIDATION_ERROR`) */
        BadRequest: {
            headers: {
                [name: string]: unknown;
            };
            content: {
                "application/problem+json": components["schemas"]["Problem"];
            };
        };
        /** @description Missing/invalid credentials */
        Unauthorized: {
            headers: {
                [name: string]: unknown;
            };
            content: {
                "application/problem+json": components["schemas"]["Problem"];
            };
        };
        /** @description Authenticated but not allowed (`FORBIDDEN`) */
        Forbidden: {
            headers: {
                [name: string]: unknown;
            };
            content: {
                "application/problem+json": components["schemas"]["Problem"];
            };
        };
        /** @description Not found */
        NotFound: {
            headers: {
                [name: string]: unknown;
            };
            content: {
                "application/problem+json": components["schemas"]["Problem"];
            };
        };
        /** @description Rate limited */
        TooManyRequests: {
            headers: {
                [name: string]: unknown;
            };
            content: {
                "application/problem+json": components["schemas"]["Problem"];
            };
        };
    };
    parameters: {
        DeviceId: string;
        EmployeeId: string;
        CategoryId: string;
        ProductId: string;
        ShiftId: string;
        TransactionId: string;
        PaymentId: string;
        VoidRequestId: string;
        /** @description Inclusive business date (WIB) */
        DateFrom: string;
        /** @description Inclusive business date (WIB) */
        DateTo: string;
        Cursor: string;
        Limit: number;
    };
    requestBodies: never;
    headers: never;
    pathItems: never;
}
export type $defs = Record<string, never>;
export interface operations {
    ownerLogin: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    /** Format: email */
                    email: string;
                    password: string;
                };
            };
        };
        responses: {
            /** @description Logged in. Refresh token is set as cookie `kk_refresh` (`HttpOnly; Secure; SameSite=Strict; Path=/v1/auth`, no `Domain`). The dashboard must call the API same-origin through the `/v1` proxy (ADR-0011). */
            200: {
                headers: {
                    "Set-Cookie"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["OwnerSession"];
                };
            };
            401: components["responses"]["Unauthorized"];
            429: components["responses"]["TooManyRequests"];
        };
    };
    ownerRefresh: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description New session */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["OwnerSession"];
                };
            };
            401: components["responses"]["Unauthorized"];
        };
    };
    ownerLogout: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Logged out */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            401: components["responses"]["Unauthorized"];
        };
    };
    employeePinLogin: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    /** Format: uuid */
                    employee_id: string;
                    pin: string;
                };
            };
        };
        responses: {
            /** @description Employee session */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["EmployeeSession"];
                };
            };
            /** @description Invalid PIN (`INVALID_PIN`) or revoked device (`DEVICE_REVOKED`) */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Employee locked after too many attempts (`PIN_LOCKED`) */
            423: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    employeePinLogout: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Logged out */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            401: components["responses"]["Unauthorized"];
        };
    };
    getMe: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Current principal */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Principal"];
                };
            };
            401: components["responses"]["Unauthorized"];
        };
    };
    listDevices: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Devices */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: components["schemas"]["Device"][];
                    };
                };
            };
            401: components["responses"]["Unauthorized"];
        };
    };
    createDevice: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    /** @example Tablet Kasir Depan */
                    name: string;
                };
            };
        };
        responses: {
            /** @description Device created with pairing code (valid 10 minutes) */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        device: components["schemas"]["Device"];
                        pairing_code: string;
                        /** Format: date-time */
                        pairing_expires_at: string;
                    };
                };
            };
            401: components["responses"]["Unauthorized"];
        };
    };
    pairDevice: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    pairing_code: string;
                    app_version?: string;
                    /** @enum {string} */
                    platform?: "android" | "ios";
                };
            };
        };
        responses: {
            /** @description Paired. `device_token` is shown only once. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        device: components["schemas"]["Device"];
                        device_token: string;
                        outlet: components["schemas"]["OutletRef"];
                        last_transaction_number?: string | null;
                    };
                };
            };
            400: components["responses"]["BadRequest"];
            429: components["responses"]["TooManyRequests"];
        };
    };
    listDeviceEmployees: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Employees (no PIN data) */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: {
                            /** Format: uuid */
                            id: string;
                            name: string;
                        }[];
                    };
                };
            };
            401: components["responses"]["Unauthorized"];
        };
    };
    revokeDevice: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                device_id: components["parameters"]["DeviceId"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Revoked */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Device"];
                };
            };
            404: components["responses"]["NotFound"];
        };
    };
    listEmployees: {
        parameters: {
            query?: {
                is_active?: boolean;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Employees */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: components["schemas"]["Employee"][];
                    };
                };
            };
            401: components["responses"]["Unauthorized"];
        };
    };
    createEmployee: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    name: string;
                    pin: string;
                };
            };
        };
        responses: {
            /** @description Created */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Employee"];
                };
            };
            /** @description PIN already used by another employee in this outlet (`PIN_NOT_UNIQUE`) */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    updateEmployee: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                employee_id: components["parameters"]["EmployeeId"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    name?: string;
                    is_active?: boolean;
                };
            };
        };
        responses: {
            /** @description Updated */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Employee"];
                };
            };
            404: components["responses"]["NotFound"];
        };
    };
    resetEmployeePin: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                employee_id: components["parameters"]["EmployeeId"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    pin: string;
                };
            };
        };
        responses: {
            /** @description PIN updated */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description `PIN_NOT_UNIQUE` */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    getCatalog: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Catalog */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Catalog"];
                };
            };
            401: components["responses"]["Unauthorized"];
        };
    };
    listCategories: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Categories */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: components["schemas"]["Category"][];
                    };
                };
            };
            401: components["responses"]["Unauthorized"];
        };
    };
    createCategory: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["CategoryInput"];
            };
        };
        responses: {
            /** @description Created */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Category"];
                };
            };
            401: components["responses"]["Unauthorized"];
        };
    };
    deleteCategory: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                category_id: components["parameters"]["CategoryId"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Deleted */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description `CATEGORY_NOT_EMPTY` */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    updateCategory: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                category_id: components["parameters"]["CategoryId"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["CategoryInput"];
            };
        };
        responses: {
            /** @description Updated */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Category"];
                };
            };
            401: components["responses"]["Unauthorized"];
        };
    };
    listProducts: {
        parameters: {
            query?: {
                category_id?: string;
                is_active?: boolean;
                /** @description Name search */
                q?: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Products */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: components["schemas"]["Product"][];
                    };
                };
            };
            401: components["responses"]["Unauthorized"];
        };
    };
    createProduct: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ProductInput"];
            };
        };
        responses: {
            /** @description Created */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Product"];
                };
            };
            400: components["responses"]["BadRequest"];
        };
    };
    getProduct: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                product_id: components["parameters"]["ProductId"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Product */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Product"];
                };
            };
            404: components["responses"]["NotFound"];
        };
    };
    deleteProduct: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                product_id: components["parameters"]["ProductId"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Deleted */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            401: components["responses"]["Unauthorized"];
        };
    };
    updateProduct: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                product_id: components["parameters"]["ProductId"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ProductInput"];
            };
        };
        responses: {
            /** @description Updated */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Product"];
                };
            };
            401: components["responses"]["Unauthorized"];
        };
    };
    setProductAvailability: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                product_id: components["parameters"]["ProductId"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    is_sold_out: boolean;
                };
            };
        };
        responses: {
            /** @description Updated */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Product"];
                };
            };
            401: components["responses"]["Unauthorized"];
        };
    };
    listShifts: {
        parameters: {
            query?: {
                /** @description Inclusive business date (WIB) */
                date_from?: components["parameters"]["DateFrom"];
                /** @description Inclusive business date (WIB) */
                date_to?: components["parameters"]["DateTo"];
                employee_id?: string;
                status?: components["schemas"]["ShiftStatus"];
                cursor?: components["parameters"]["Cursor"];
                limit?: components["parameters"]["Limit"];
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Shifts */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: components["schemas"]["Shift"][];
                        next_cursor: string | null;
                    };
                };
            };
            401: components["responses"]["Unauthorized"];
        };
    };
    openShift: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    /**
                     * Format: uuid
                     * @description Client-generated UUIDv7
                     */
                    id: string;
                    opening_cash: components["schemas"]["Rupiah"];
                    /** Format: date-time */
                    opened_at: string;
                };
            };
        };
        responses: {
            /** @description Same id already exists (idempotent replay) */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Shift"];
                };
            };
            /** @description Shift opened */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Shift"];
                };
            };
            /** @description The outlet already has an open shift (`SHIFT_ALREADY_OPEN`); the body `detail` names it. Join it instead. */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    getCurrentShift: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Open shift */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Shift"];
                };
            };
            /** @description No open shift */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            401: components["responses"]["Unauthorized"];
        };
    };
    getShiftSummary: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                shift_id: components["parameters"]["ShiftId"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Summary */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ShiftSummary"];
                };
            };
            403: components["responses"]["Forbidden"];
        };
    };
    closeShift: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                shift_id: components["parameters"]["ShiftId"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    actual_cash: components["schemas"]["Rupiah"];
                    /** Format: date-time */
                    closed_at: string;
                    closing_note?: string;
                    /**
                     * @description True when the close was done offline and is being replayed via sync
                     * @default false
                     */
                    closed_offline?: boolean;
                    /** @description Mutations still queued on the closing device at close time */
                    unsynced_count?: number;
                };
            };
        };
        responses: {
            /** @description Closed shift with summary */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ShiftSummary"];
                };
            };
            /** @description `SHIFT_CLOSED` or `PENDING_QRIS_EXISTS` (cancel or settle pending QRIS first) */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    listTransactions: {
        parameters: {
            query?: {
                scope?: "shift" | "today";
                /** @description Inclusive business date (WIB) */
                date_from?: components["parameters"]["DateFrom"];
                /** @description Inclusive business date (WIB) */
                date_to?: components["parameters"]["DateTo"];
                employee_id?: string;
                shift_id?: string;
                payment_method?: components["schemas"]["PaymentMethod"];
                status?: components["schemas"]["TransactionStatus"];
                /** @description Transaction number or customer label */
                q?: string;
                cursor?: components["parameters"]["Cursor"];
                limit?: components["parameters"]["Limit"];
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Transactions (without items) */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: components["schemas"]["TransactionSummary"][];
                        next_cursor: string | null;
                    };
                };
            };
            401: components["responses"]["Unauthorized"];
        };
    };
    createTransaction: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["TransactionCreate"];
            };
        };
        responses: {
            /** @description Same id already exists (idempotent replay) */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Transaction"];
                };
            };
            /** @description Created */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Transaction"];
                };
            };
            /** @description `SHIFT_NOT_OPEN`, `SHIFT_CLOSED`, `NUMBER_CONFLICT` */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description `TOTAL_MISMATCH`, `CASH_INSUFFICIENT`, `PRODUCT_UNAVAILABLE` */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description `QRIS_PROVIDER_UNAVAILABLE` */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    exportTransactions: {
        parameters: {
            query: {
                format: "csv" | "xlsx";
                /** @description Inclusive business date (WIB) */
                date_from?: components["parameters"]["DateFrom"];
                /** @description Inclusive business date (WIB) */
                date_to?: components["parameters"]["DateTo"];
                employee_id?: string;
                payment_method?: components["schemas"]["PaymentMethod"];
                status?: components["schemas"]["TransactionStatus"];
                /** @description One row per item instead of per transaction */
                detail?: boolean;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description File stream */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "text/csv": string;
                    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": string;
                };
            };
            401: components["responses"]["Unauthorized"];
        };
    };
    getTransaction: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                transaction_id: components["parameters"]["TransactionId"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Transaction */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Transaction"];
                };
            };
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
        };
    };
    getReceipt: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                transaction_id: components["parameters"]["TransactionId"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Receipt */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Receipt"];
                };
            };
            401: components["responses"]["Unauthorized"];
        };
    };
    createVoidRequest: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                transaction_id: components["parameters"]["TransactionId"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    /** Format: uuid */
                    id: string;
                    reason: string;
                };
            };
        };
        responses: {
            /** @description Void request created */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["VoidRequest"];
                };
            };
            /** @description `TRANSACTION_NOT_VOIDABLE` (not paid / already requested) */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    getPayment: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                payment_id: components["parameters"]["PaymentId"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Payment */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Payment"];
                };
            };
            401: components["responses"]["Unauthorized"];
        };
    };
    confirmPayment: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                payment_id: components["parameters"]["PaymentId"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Payment paid; transaction becomes `paid` */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Transaction"];
                };
            };
            /** @description `CONFIRMATION_NOT_ALLOWED` (auto mode) or `PAYMENT_NOT_PENDING` */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    cancelPayment: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                payment_id: components["parameters"]["PaymentId"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Cancelled */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Transaction"];
                };
            };
            401: components["responses"]["Unauthorized"];
        };
    };
    paymentWebhook: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                provider: "midtrans" | "xendit";
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    [key: string]: unknown;
                };
            };
        };
        responses: {
            /** @description Acknowledged */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            401: components["responses"]["Unauthorized"];
        };
    };
    listVoidRequests: {
        parameters: {
            query?: {
                status?: "pending" | "approved" | "rejected";
                cursor?: components["parameters"]["Cursor"];
                limit?: components["parameters"]["Limit"];
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Void requests */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: components["schemas"]["VoidRequest"][];
                        next_cursor: string | null;
                    };
                };
            };
            401: components["responses"]["Unauthorized"];
        };
    };
    approveVoidRequest: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                void_request_id: components["parameters"]["VoidRequestId"];
            };
            cookie?: never;
        };
        requestBody?: {
            content: {
                "application/json": components["schemas"]["VoidDecision"];
            };
        };
        responses: {
            /** @description Approved; transaction `voided` */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["VoidRequest"];
                };
            };
            401: components["responses"]["Unauthorized"];
        };
    };
    rejectVoidRequest: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                void_request_id: components["parameters"]["VoidRequestId"];
            };
            cookie?: never;
        };
        requestBody?: {
            content: {
                "application/json": components["schemas"]["VoidDecision"];
            };
        };
        responses: {
            /** @description Rejected */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["VoidRequest"];
                };
            };
            401: components["responses"]["Unauthorized"];
        };
    };
    approveVoidWithOwnerPin: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                void_request_id: components["parameters"]["VoidRequestId"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    owner_pin: string;
                    note?: string;
                };
            };
        };
        responses: {
            /** @description Approved */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["VoidRequest"];
                };
            };
            /** @description `INVALID_OWNER_PIN` */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    syncPull: {
        parameters: {
            query?: {
                /** @description Opaque; omit for full snapshot */
                cursor?: string;
                limit?: number;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Changes */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SyncPullResponse"];
                };
            };
            401: components["responses"]["Unauthorized"];
        };
    };
    syncPush: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    mutations: components["schemas"]["SyncMutation"][];
                };
            };
        };
        responses: {
            /** @description Per-mutation result */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        results: {
                            /** Format: uuid */
                            id: string;
                            /** @enum {string} */
                            status: "applied" | "duplicate" | "rejected";
                            /** @description Error code when rejected */
                            code?: string;
                            detail?: string;
                        }[];
                    };
                };
            };
            401: components["responses"]["Unauthorized"];
        };
    };
    getDashboardSummary: {
        parameters: {
            query?: {
                /** @description Inclusive business date (WIB) */
                date_from?: components["parameters"]["DateFrom"];
                /** @description Inclusive business date (WIB) */
                date_to?: components["parameters"]["DateTo"];
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Summary */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["DashboardSummary"];
                };
            };
            401: components["responses"]["Unauthorized"];
        };
    };
    getSalesSeries: {
        parameters: {
            query: {
                /** @description Inclusive business date (WIB) */
                date_from?: components["parameters"]["DateFrom"];
                /** @description Inclusive business date (WIB) */
                date_to?: components["parameters"]["DateTo"];
                granularity: "hour" | "day";
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Series */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: {
                            /** Format: date-time */
                            bucket_start: string;
                            revenue: components["schemas"]["Rupiah"];
                            transaction_count: number;
                        }[];
                    };
                };
            };
            401: components["responses"]["Unauthorized"];
        };
    };
    getTopProducts: {
        parameters: {
            query?: {
                /** @description Inclusive business date (WIB) */
                date_from?: components["parameters"]["DateFrom"];
                /** @description Inclusive business date (WIB) */
                date_to?: components["parameters"]["DateTo"];
                limit?: number;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Top products */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: {
                            /** Format: uuid */
                            product_id?: string | null;
                            product_name: string;
                            quantity: number;
                            revenue: components["schemas"]["Rupiah"];
                        }[];
                    };
                };
            };
            401: components["responses"]["Unauthorized"];
        };
    };
    getSalesReport: {
        parameters: {
            query: {
                /** @description Inclusive business date (WIB) */
                date_from?: components["parameters"]["DateFrom"];
                /** @description Inclusive business date (WIB) */
                date_to?: components["parameters"]["DateTo"];
                group_by: "product" | "employee" | "payment_method" | "day";
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Report rows */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: {
                            key: string;
                            label: string;
                            quantity: number;
                            transaction_count: number;
                            revenue: components["schemas"]["Rupiah"];
                        }[];
                    };
                };
            };
            401: components["responses"]["Unauthorized"];
        };
    };
    getSettings: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Settings */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["OutletSettings"];
                };
            };
            401: components["responses"]["Unauthorized"];
        };
    };
    updateSettings: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["OutletSettingsInput"];
            };
        };
        responses: {
            /** @description Updated */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["OutletSettings"];
                };
            };
            /** @description `INVALID_QRIS_PAYLOAD` */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    createUpload: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    /** @enum {string} */
                    purpose: "product_image" | "logo" | "qris_image";
                    /** @enum {string} */
                    content_type: "image/jpeg" | "image/png" | "image/webp";
                    size_bytes: number;
                };
            };
        };
        responses: {
            /** @description Presigned PUT URL; use `public_url` in the product/settings payload afterwards. */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** Format: uri */
                        upload_url: string;
                        /** Format: uri */
                        public_url: string;
                        /** Format: date-time */
                        expires_at: string;
                    };
                };
            };
            401: components["responses"]["Unauthorized"];
        };
    };
}
