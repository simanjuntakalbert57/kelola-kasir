CREATE SEQUENCE "public"."catalog_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1;--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"outlet_id" uuid,
	"actor_type" text NOT NULL,
	"actor_id" uuid,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid,
	"before" jsonb,
	"after" jsonb,
	"meta" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "audit_logs_actor_type_check" CHECK ("audit_logs"."actor_type" IN ('user', 'employee', 'device', 'system'))
);
--> statement-breakpoint
CREATE TABLE "categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"outlet_id" uuid NOT NULL,
	"name" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_seq" bigint DEFAULT nextval('catalog_seq') NOT NULL
);
--> statement-breakpoint
CREATE TABLE "device_pairing_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"device_id" uuid NOT NULL,
	"code_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "device_pairing_codes_code_hash_unique" UNIQUE("code_hash")
);
--> statement-breakpoint
CREATE TABLE "devices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"outlet_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"token_hash" text,
	"paired_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"last_seen_at" timestamp with time zone,
	"app_version" text,
	"platform" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "devices_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "employee_pin_attempts" (
	"employee_id" uuid NOT NULL,
	"device_id" uuid NOT NULL,
	"failed_count" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "employee_pin_attempts_employee_id_device_id_pk" PRIMARY KEY("employee_id","device_id")
);
--> statement-breakpoint
CREATE TABLE "employee_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"employee_id" uuid NOT NULL,
	"device_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "employees" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"outlet_id" uuid NOT NULL,
	"name" text NOT NULL,
	"pin_hash" text NOT NULL,
	"pin_fingerprint" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_seq" bigint DEFAULT nextval('catalog_seq') NOT NULL
);
--> statement-breakpoint
CREATE TABLE "idempotency_keys" (
	"scope_id" uuid NOT NULL,
	"key" text NOT NULL,
	"method" text NOT NULL,
	"path" text NOT NULL,
	"request_hash" text NOT NULL,
	"response_status" integer,
	"response_body" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "idempotency_keys_scope_id_key_pk" PRIMARY KEY("scope_id","key")
);
--> statement-breakpoint
CREATE TABLE "outlet_members" (
	"outlet_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" text NOT NULL,
	CONSTRAINT "outlet_members_outlet_id_user_id_pk" PRIMARY KEY("outlet_id","user_id"),
	CONSTRAINT "outlet_members_role_check" CHECK ("outlet_members"."role" IN ('owner', 'manager'))
);
--> statement-breakpoint
CREATE TABLE "outlet_settings" (
	"outlet_id" uuid PRIMARY KEY NOT NULL,
	"display_name" text NOT NULL,
	"address" text,
	"phone" text,
	"logo_url" text,
	"receipt_header" text,
	"receipt_footer" text,
	"qris_mode" text DEFAULT 'static' NOT NULL,
	"qris_static_payload" text,
	"qris_static_image_url" text,
	"qris_merchant_name" text,
	"qris_embed_amount" boolean DEFAULT false NOT NULL,
	"offline_login_enabled" boolean DEFAULT false NOT NULL,
	"quick_cash_amounts" jsonb DEFAULT '[20000, 50000, 100000]'::jsonb NOT NULL,
	"updated_seq" bigint DEFAULT nextval('catalog_seq') NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "outlets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"timezone" text DEFAULT 'Asia/Jakarta' NOT NULL,
	"device_seq" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "outlets_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"transaction_id" uuid NOT NULL,
	"method" text NOT NULL,
	"provider" text NOT NULL,
	"status" text NOT NULL,
	"amount" bigint NOT NULL,
	"cash_tendered" bigint,
	"cash_change" bigint,
	"provider_ref" text,
	"qr_payload" text,
	"expires_at" timestamp with time zone,
	"confirmation_mode" text,
	"confirmed_by" uuid,
	"paid_at" timestamp with time zone,
	"provider_raw" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payments_method_check" CHECK ("payments"."method" IN ('cash', 'qris')),
	CONSTRAINT "payments_provider_check" CHECK ("payments"."provider" IN ('cash', 'qris_static', 'midtrans', 'xendit')),
	CONSTRAINT "payments_status_check" CHECK ("payments"."status" IN ('pending', 'paid', 'expired', 'failed', 'cancelled')),
	CONSTRAINT "payments_amount_check" CHECK ("payments"."amount" >= 0)
);
--> statement-breakpoint
CREATE TABLE "products" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"outlet_id" uuid NOT NULL,
	"category_id" uuid NOT NULL,
	"name" text NOT NULL,
	"image_url" text,
	"price" bigint NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"is_sold_out" boolean DEFAULT false NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_seq" bigint DEFAULT nextval('catalog_seq') NOT NULL,
	CONSTRAINT "products_price_check" CHECK ("products"."price" >= 0)
);
--> statement-breakpoint
CREATE TABLE "refresh_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"family_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "refresh_tokens_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "shifts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"outlet_id" uuid NOT NULL,
	"opened_device_id" uuid NOT NULL,
	"closed_device_id" uuid,
	"opened_by" uuid NOT NULL,
	"closed_by" uuid,
	"status" text DEFAULT 'open' NOT NULL,
	"opening_cash" bigint NOT NULL,
	"expected_cash" bigint,
	"actual_cash" bigint,
	"cash_difference" bigint,
	"total_cash_sales" bigint,
	"total_qris_sales" bigint,
	"transaction_count" integer,
	"opened_at" timestamp with time zone NOT NULL,
	"closed_at" timestamp with time zone,
	"closing_note" text,
	"closed_offline" boolean DEFAULT false NOT NULL,
	"unsynced_count" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "shifts_status_check" CHECK ("shifts"."status" IN ('open', 'closed')),
	CONSTRAINT "shifts_opening_cash_check" CHECK ("shifts"."opening_cash" >= 0),
	CONSTRAINT "shifts_closed_fields_check" CHECK (("shifts"."status" = 'open') OR ("shifts"."closed_at" IS NOT NULL AND "shifts"."actual_cash" IS NOT NULL AND "shifts"."closed_by" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "transaction_items" (
	"id" uuid PRIMARY KEY NOT NULL,
	"transaction_id" uuid NOT NULL,
	"product_id" uuid,
	"product_name" text NOT NULL,
	"unit_price" bigint NOT NULL,
	"quantity" integer NOT NULL,
	"line_total" bigint NOT NULL,
	"note" text,
	CONSTRAINT "transaction_items_quantity_check" CHECK ("transaction_items"."quantity" BETWEEN 1 AND 999),
	CONSTRAINT "transaction_items_amounts_check" CHECK ("transaction_items"."unit_price" >= 0 AND "transaction_items"."line_total" = "transaction_items"."unit_price" * "transaction_items"."quantity")
);
--> statement-breakpoint
CREATE TABLE "transactions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"outlet_id" uuid NOT NULL,
	"shift_id" uuid NOT NULL,
	"device_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"number" text NOT NULL,
	"status" text NOT NULL,
	"payment_method" text NOT NULL,
	"customer_label" text,
	"subtotal" bigint NOT NULL,
	"discount_amount" bigint DEFAULT 0 NOT NULL,
	"tax_amount" bigint DEFAULT 0 NOT NULL,
	"total" bigint NOT NULL,
	"price_mismatch" boolean DEFAULT false NOT NULL,
	"after_shift_close" boolean DEFAULT false NOT NULL,
	"client_created_at" timestamp with time zone NOT NULL,
	"server_received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"paid_at" timestamp with time zone,
	"voided_at" timestamp with time zone,
	CONSTRAINT "transactions_status_check" CHECK ("transactions"."status" IN ('pending', 'paid', 'void_requested', 'voided', 'cancelled')),
	CONSTRAINT "transactions_method_check" CHECK ("transactions"."payment_method" IN ('cash', 'qris')),
	CONSTRAINT "transactions_amounts_check" CHECK ("transactions"."subtotal" >= 0 AND "transactions"."discount_amount" >= 0 AND "transactions"."tax_amount" >= 0 AND "transactions"."total" >= 0 AND "transactions"."total" = "transactions"."subtotal" - "transactions"."discount_amount" + "transactions"."tax_amount")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"name" text NOT NULL,
	"owner_pin_hash" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"failed_login_count" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "void_requests" (
	"id" uuid PRIMARY KEY NOT NULL,
	"transaction_id" uuid NOT NULL,
	"requested_by" uuid NOT NULL,
	"reason" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"decided_by" uuid,
	"decision_channel" text,
	"decision_note" text,
	"requested_at" timestamp with time zone NOT NULL,
	"decided_at" timestamp with time zone,
	CONSTRAINT "void_requests_status_check" CHECK ("void_requests"."status" IN ('pending', 'approved', 'rejected')),
	CONSTRAINT "void_requests_channel_check" CHECK ("void_requests"."decision_channel" IS NULL OR "void_requests"."decision_channel" IN ('dashboard', 'device_pin'))
);
--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_outlet_id_outlets_id_fk" FOREIGN KEY ("outlet_id") REFERENCES "public"."outlets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "categories" ADD CONSTRAINT "categories_outlet_id_outlets_id_fk" FOREIGN KEY ("outlet_id") REFERENCES "public"."outlets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_pairing_codes" ADD CONSTRAINT "device_pairing_codes_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "devices" ADD CONSTRAINT "devices_outlet_id_outlets_id_fk" FOREIGN KEY ("outlet_id") REFERENCES "public"."outlets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_pin_attempts" ADD CONSTRAINT "employee_pin_attempts_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_pin_attempts" ADD CONSTRAINT "employee_pin_attempts_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_sessions" ADD CONSTRAINT "employee_sessions_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_sessions" ADD CONSTRAINT "employee_sessions_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employees" ADD CONSTRAINT "employees_outlet_id_outlets_id_fk" FOREIGN KEY ("outlet_id") REFERENCES "public"."outlets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outlet_members" ADD CONSTRAINT "outlet_members_outlet_id_outlets_id_fk" FOREIGN KEY ("outlet_id") REFERENCES "public"."outlets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outlet_members" ADD CONSTRAINT "outlet_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outlet_settings" ADD CONSTRAINT "outlet_settings_outlet_id_outlets_id_fk" FOREIGN KEY ("outlet_id") REFERENCES "public"."outlets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_transaction_id_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."transactions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_confirmed_by_employees_id_fk" FOREIGN KEY ("confirmed_by") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_outlet_id_outlets_id_fk" FOREIGN KEY ("outlet_id") REFERENCES "public"."outlets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shifts" ADD CONSTRAINT "shifts_outlet_id_outlets_id_fk" FOREIGN KEY ("outlet_id") REFERENCES "public"."outlets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shifts" ADD CONSTRAINT "shifts_opened_device_id_devices_id_fk" FOREIGN KEY ("opened_device_id") REFERENCES "public"."devices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shifts" ADD CONSTRAINT "shifts_closed_device_id_devices_id_fk" FOREIGN KEY ("closed_device_id") REFERENCES "public"."devices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shifts" ADD CONSTRAINT "shifts_opened_by_employees_id_fk" FOREIGN KEY ("opened_by") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shifts" ADD CONSTRAINT "shifts_closed_by_employees_id_fk" FOREIGN KEY ("closed_by") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction_items" ADD CONSTRAINT "transaction_items_transaction_id_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."transactions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction_items" ADD CONSTRAINT "transaction_items_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_outlet_id_outlets_id_fk" FOREIGN KEY ("outlet_id") REFERENCES "public"."outlets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_shift_id_shifts_id_fk" FOREIGN KEY ("shift_id") REFERENCES "public"."shifts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "void_requests" ADD CONSTRAINT "void_requests_transaction_id_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."transactions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "void_requests" ADD CONSTRAINT "void_requests_requested_by_employees_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "void_requests" ADD CONSTRAINT "void_requests_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_logs_outlet_created_idx" ON "audit_logs" USING btree ("outlet_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "audit_logs_entity_idx" ON "audit_logs" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "categories_outlet_seq_idx" ON "categories" USING btree ("outlet_id","updated_seq");--> statement-breakpoint
CREATE UNIQUE INDEX "devices_outlet_code_unique" ON "devices" USING btree ("outlet_id","code");--> statement-breakpoint
CREATE INDEX "employee_sessions_device_idx" ON "employee_sessions" USING btree ("device_id");--> statement-breakpoint
CREATE UNIQUE INDEX "employees_pin_unique_per_outlet" ON "employees" USING btree ("outlet_id","pin_fingerprint") WHERE "employees"."is_active";--> statement-breakpoint
CREATE INDEX "employees_outlet_idx" ON "employees" USING btree ("outlet_id","updated_seq");--> statement-breakpoint
CREATE INDEX "payments_transaction_idx" ON "payments" USING btree ("transaction_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payments_provider_ref_unique" ON "payments" USING btree ("provider","provider_ref") WHERE "payments"."provider_ref" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "products_outlet_seq_idx" ON "products" USING btree ("outlet_id","updated_seq");--> statement-breakpoint
CREATE INDEX "refresh_tokens_family_idx" ON "refresh_tokens" USING btree ("family_id");--> statement-breakpoint
CREATE UNIQUE INDEX "shifts_one_open_per_outlet" ON "shifts" USING btree ("outlet_id") WHERE "shifts"."status" = 'open';--> statement-breakpoint
CREATE INDEX "shifts_outlet_opened_idx" ON "shifts" USING btree ("outlet_id","opened_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "transaction_items_transaction_idx" ON "transaction_items" USING btree ("transaction_id");--> statement-breakpoint
CREATE UNIQUE INDEX "transactions_outlet_number_unique" ON "transactions" USING btree ("outlet_id","number");--> statement-breakpoint
CREATE INDEX "transactions_outlet_created_idx" ON "transactions" USING btree ("outlet_id","client_created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "transactions_shift_idx" ON "transactions" USING btree ("shift_id");--> statement-breakpoint
CREATE INDEX "transactions_outlet_status_idx" ON "transactions" USING btree ("outlet_id","status");--> statement-breakpoint
CREATE INDEX "transactions_outlet_employee_idx" ON "transactions" USING btree ("outlet_id","employee_id","client_created_at");--> statement-breakpoint
CREATE INDEX "void_requests_transaction_idx" ON "void_requests" USING btree ("transaction_id");