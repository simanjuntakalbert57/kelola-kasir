CREATE TABLE "expense_categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"outlet_id" uuid NOT NULL,
	"category_group" text NOT NULL,
	"name" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_seq" bigint DEFAULT nextval('catalog_seq') NOT NULL,
	CONSTRAINT "expense_categories_group_check" CHECK ("expense_categories"."category_group" IN ('hpp', 'operasional', 'tetap', 'lainnya')),
	CONSTRAINT "expense_categories_name_check" CHECK (char_length("expense_categories"."name") BETWEEN 1 AND 40)
);
--> statement-breakpoint
CREATE TABLE "expense_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"outlet_id" uuid NOT NULL,
	"expense_id" uuid NOT NULL,
	"action" text NOT NULL,
	"changes" jsonb,
	"reason" text,
	"actor_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "expense_history_action_check" CHECK ("expense_history"."action" IN ('create', 'update', 'delete', 'restore')),
	CONSTRAINT "expense_history_reason_check" CHECK ("expense_history"."action" <> 'delete' OR "expense_history"."reason" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "expenses" (
	"id" uuid PRIMARY KEY NOT NULL,
	"outlet_id" uuid NOT NULL,
	"category_id" uuid NOT NULL,
	"spent_on" date NOT NULL,
	"description" text NOT NULL,
	"amount" bigint NOT NULL,
	"funding_source" text NOT NULL,
	"receipt_image_key" text,
	"source" text DEFAULT 'dashboard' NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"deleted_by" uuid,
	"delete_reason" text,
	CONSTRAINT "expenses_amount_check" CHECK ("expenses"."amount" > 0 AND "expenses"."amount" <= 1000000000),
	CONSTRAINT "expenses_funding_source_check" CHECK ("expenses"."funding_source" IN ('drawer', 'owner')),
	CONSTRAINT "expenses_source_check" CHECK ("expenses"."source" IN ('dashboard', 'cash_movement')),
	CONSTRAINT "expenses_description_check" CHECK (char_length("expenses"."description") BETWEEN 1 AND 200),
	CONSTRAINT "expenses_deleted_fields_check" CHECK (("expenses"."deleted_at" IS NULL AND "expenses"."deleted_by" IS NULL AND "expenses"."delete_reason" IS NULL) OR ("expenses"."deleted_at" IS NOT NULL AND "expenses"."deleted_by" IS NOT NULL AND "expenses"."delete_reason" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "outlets" ADD COLUMN "previous_codes" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "expense_categories" ADD CONSTRAINT "expense_categories_outlet_id_outlets_id_fk" FOREIGN KEY ("outlet_id") REFERENCES "public"."outlets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expense_history" ADD CONSTRAINT "expense_history_outlet_id_outlets_id_fk" FOREIGN KEY ("outlet_id") REFERENCES "public"."outlets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expense_history" ADD CONSTRAINT "expense_history_expense_id_expenses_id_fk" FOREIGN KEY ("expense_id") REFERENCES "public"."expenses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expense_history" ADD CONSTRAINT "expense_history_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_outlet_id_outlets_id_fk" FOREIGN KEY ("outlet_id") REFERENCES "public"."outlets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_deleted_by_users_id_fk" FOREIGN KEY ("deleted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- The composite FK below needs this unique index first (drizzle-kit emits indexes after FKs).
CREATE UNIQUE INDEX "expense_categories_id_outlet_unique" ON "expense_categories" USING btree ("id","outlet_id");--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_category_outlet_fk" FOREIGN KEY ("category_id","outlet_id") REFERENCES "public"."expense_categories"("id","outlet_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "expense_categories_outlet_name_unique" ON "expense_categories" USING btree ("outlet_id",lower("name")) WHERE "expense_categories"."archived_at" IS NULL;--> statement-breakpoint
CREATE INDEX "expense_categories_outlet_seq_idx" ON "expense_categories" USING btree ("outlet_id","updated_seq");--> statement-breakpoint
CREATE INDEX "expense_history_expense_idx" ON "expense_history" USING btree ("expense_id","created_at");--> statement-breakpoint
CREATE INDEX "expense_history_outlet_created_idx" ON "expense_history" USING btree ("outlet_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "expenses_outlet_spent_idx" ON "expenses" USING btree ("outlet_id","spent_on" DESC NULLS LAST) WHERE "expenses"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "expenses_outlet_deleted_idx" ON "expenses" USING btree ("outlet_id","deleted_at");--> statement-breakpoint
CREATE INDEX "expenses_category_idx" ON "expenses" USING btree ("category_id");