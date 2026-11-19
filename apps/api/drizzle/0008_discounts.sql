CREATE TABLE "discount_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"discount_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"action" text NOT NULL,
	"snapshot" jsonb NOT NULL,
	"changes" jsonb,
	"reason" text,
	"actor_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "discount_history_action_check" CHECK ("discount_history"."action" IN ('create', 'update', 'activate', 'deactivate', 'delete')),
	CONSTRAINT "discount_history_reason_check" CHECK ("discount_history"."action" <> 'delete' OR "discount_history"."reason" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "discount_outlets" (
	"discount_id" uuid NOT NULL,
	"outlet_id" uuid NOT NULL,
	"removed_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_seq" bigint DEFAULT nextval('catalog_seq') NOT NULL,
	CONSTRAINT "discount_outlets_discount_id_outlet_id_pk" PRIMARY KEY("discount_id","outlet_id")
);
--> statement-breakpoint
CREATE TABLE "discount_targets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"discount_id" uuid NOT NULL,
	"outlet_id" uuid NOT NULL,
	"product_id" uuid,
	"category_id" uuid,
	CONSTRAINT "discount_targets_one_target_check" CHECK (("discount_targets"."product_id" IS NOT NULL) <> ("discount_targets"."category_id" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "discounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"target_type" text NOT NULL,
	"type" text NOT NULL,
	"value" integer NOT NULL,
	"starts_on" date NOT NULL,
	"ends_on" date,
	"days_of_week" smallint[],
	"time_start" text,
	"time_end" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"deleted_by" uuid,
	"delete_reason" text,
	CONSTRAINT "discounts_name_check" CHECK (char_length("discounts"."name") BETWEEN 1 AND 60),
	CONSTRAINT "discounts_target_type_check" CHECK ("discounts"."target_type" IN ('product', 'category')),
	CONSTRAINT "discounts_type_check" CHECK ("discounts"."type" IN ('percent', 'amount')),
	CONSTRAINT "discounts_value_check" CHECK (("discounts"."type" = 'percent' AND "discounts"."value" BETWEEN 1 AND 100) OR ("discounts"."type" = 'amount' AND "discounts"."value" BETWEEN 1 AND 100000000)),
	CONSTRAINT "discounts_period_check" CHECK ("discounts"."ends_on" IS NULL OR "discounts"."ends_on" >= "discounts"."starts_on"),
	CONSTRAINT "discounts_days_check" CHECK ("discounts"."days_of_week" IS NULL OR (cardinality("discounts"."days_of_week") BETWEEN 1 AND 7 AND "discounts"."days_of_week" <@ ARRAY[1,2,3,4,5,6,7]::smallint[])),
	CONSTRAINT "discounts_time_check" CHECK (("discounts"."time_start" IS NULL AND "discounts"."time_end" IS NULL) OR ("discounts"."time_start" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' AND "discounts"."time_end" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' AND "discounts"."time_start" < "discounts"."time_end")),
	CONSTRAINT "discounts_version_check" CHECK ("discounts"."version" >= 1),
	CONSTRAINT "discounts_deleted_fields_check" CHECK (("discounts"."deleted_at" IS NULL AND "discounts"."deleted_by" IS NULL AND "discounts"."delete_reason" IS NULL) OR ("discounts"."deleted_at" IS NOT NULL AND "discounts"."deleted_by" IS NOT NULL AND "discounts"."delete_reason" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "transaction_items" ADD COLUMN "discount_id" uuid;--> statement-breakpoint
ALTER TABLE "transaction_items" ADD COLUMN "discount_version" integer;--> statement-breakpoint
ALTER TABLE "transaction_items" ADD COLUMN "discount_name" text;--> statement-breakpoint
ALTER TABLE "transaction_items" ADD COLUMN "discount_amount" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
-- The composite FKs of discount_targets need these unique indexes first (drizzle-kit emits indexes after FKs).
CREATE UNIQUE INDEX "categories_id_outlet_unique" ON "categories" USING btree ("id","outlet_id");--> statement-breakpoint
CREATE UNIQUE INDEX "products_id_outlet_unique" ON "products" USING btree ("id","outlet_id");--> statement-breakpoint
ALTER TABLE "discount_history" ADD CONSTRAINT "discount_history_discount_id_discounts_id_fk" FOREIGN KEY ("discount_id") REFERENCES "public"."discounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discount_history" ADD CONSTRAINT "discount_history_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discount_outlets" ADD CONSTRAINT "discount_outlets_discount_id_discounts_id_fk" FOREIGN KEY ("discount_id") REFERENCES "public"."discounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discount_outlets" ADD CONSTRAINT "discount_outlets_outlet_id_outlets_id_fk" FOREIGN KEY ("outlet_id") REFERENCES "public"."outlets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discount_targets" ADD CONSTRAINT "discount_targets_discount_outlet_fk" FOREIGN KEY ("discount_id","outlet_id") REFERENCES "public"."discount_outlets"("discount_id","outlet_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discount_targets" ADD CONSTRAINT "discount_targets_product_outlet_fk" FOREIGN KEY ("product_id","outlet_id") REFERENCES "public"."products"("id","outlet_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discount_targets" ADD CONSTRAINT "discount_targets_category_outlet_fk" FOREIGN KEY ("category_id","outlet_id") REFERENCES "public"."categories"("id","outlet_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discounts" ADD CONSTRAINT "discounts_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discounts" ADD CONSTRAINT "discounts_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discounts" ADD CONSTRAINT "discounts_deleted_by_users_id_fk" FOREIGN KEY ("deleted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "discount_history_discount_version_unique" ON "discount_history" USING btree ("discount_id","version");--> statement-breakpoint
CREATE INDEX "discount_outlets_outlet_seq_idx" ON "discount_outlets" USING btree ("outlet_id","updated_seq");--> statement-breakpoint
CREATE UNIQUE INDEX "discount_targets_product_unique" ON "discount_targets" USING btree ("discount_id","product_id") WHERE "discount_targets"."product_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "discount_targets_category_unique" ON "discount_targets" USING btree ("discount_id","category_id") WHERE "discount_targets"."category_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "discount_targets_discount_outlet_idx" ON "discount_targets" USING btree ("discount_id","outlet_id");--> statement-breakpoint
CREATE INDEX "discount_targets_product_idx" ON "discount_targets" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "discount_targets_category_idx" ON "discount_targets" USING btree ("category_id");--> statement-breakpoint
ALTER TABLE "transaction_items" ADD CONSTRAINT "transaction_items_discount_id_discounts_id_fk" FOREIGN KEY ("discount_id") REFERENCES "public"."discounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "transaction_items_discount_idx" ON "transaction_items" USING btree ("discount_id");--> statement-breakpoint
ALTER TABLE "transaction_items" ADD CONSTRAINT "transaction_items_discount_check" CHECK ("transaction_items"."discount_amount" >= 0 AND "transaction_items"."discount_amount" <= "transaction_items"."line_total" AND ("transaction_items"."discount_id" IS NULL) = ("transaction_items"."discount_version" IS NULL) AND ("transaction_items"."discount_id" IS NOT NULL OR "transaction_items"."discount_amount" = 0));