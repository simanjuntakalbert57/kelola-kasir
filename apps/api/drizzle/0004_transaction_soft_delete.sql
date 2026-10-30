CREATE TABLE "transaction_deletions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"outlet_id" uuid NOT NULL,
	"transaction_id" uuid NOT NULL,
	"action" text NOT NULL,
	"reason" text,
	"actor_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "transaction_deletions_action_check" CHECK ("transaction_deletions"."action" IN ('delete', 'restore')),
	CONSTRAINT "transaction_deletions_reason_check" CHECK ("transaction_deletions"."action" <> 'delete' OR "transaction_deletions"."reason" IS NOT NULL)
);
--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "deleted_by" uuid;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "delete_reason" text;--> statement-breakpoint
ALTER TABLE "transaction_deletions" ADD CONSTRAINT "transaction_deletions_outlet_id_outlets_id_fk" FOREIGN KEY ("outlet_id") REFERENCES "public"."outlets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction_deletions" ADD CONSTRAINT "transaction_deletions_transaction_id_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."transactions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction_deletions" ADD CONSTRAINT "transaction_deletions_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "transaction_deletions_transaction_idx" ON "transaction_deletions" USING btree ("transaction_id","created_at");--> statement-breakpoint
CREATE INDEX "transaction_deletions_outlet_created_idx" ON "transaction_deletions" USING btree ("outlet_id","created_at" DESC NULLS LAST);--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_deleted_by_users_id_fk" FOREIGN KEY ("deleted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "transactions_outlet_deleted_idx" ON "transactions" USING btree ("outlet_id","deleted_at");--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_deleted_fields_check" CHECK (("transactions"."deleted_at" IS NULL AND "transactions"."deleted_by" IS NULL AND "transactions"."delete_reason" IS NULL) OR ("transactions"."deleted_at" IS NOT NULL AND "transactions"."deleted_by" IS NOT NULL AND "transactions"."delete_reason" IS NOT NULL));--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_deleted_status_check" CHECK ("transactions"."deleted_at" IS NULL OR "transactions"."status" NOT IN ('pending', 'void_requested'));