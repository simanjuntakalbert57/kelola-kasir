CREATE TABLE "notification_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"outlet_id" uuid NOT NULL,
	"subscription_id" uuid NOT NULL,
	"event" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"payload" jsonb NOT NULL,
	"ttl_seconds" integer NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone,
	CONSTRAINT "notification_log_event_check" CHECK ("notification_log"."event" IN ('transaction.paid', 'transaction.batch', 'void.requested', 'void.approved', 'subscription.test')),
	CONSTRAINT "notification_log_status_check" CHECK ("notification_log"."status" IN ('pending', 'sent', 'failed', 'expired'))
);
--> statement-breakpoint
CREATE TABLE "notification_prefs" (
	"outlet_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"prefs" jsonb DEFAULT '{"transaction": true, "void": true}'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notification_prefs_outlet_id_user_id_pk" PRIMARY KEY("outlet_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "push_subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"outlet_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"endpoint" text NOT NULL,
	"p256dh" text NOT NULL,
	"auth" text NOT NULL,
	"label" text NOT NULL,
	"user_agent" text,
	"last_delivered_at" timestamp with time zone,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	"revoked_reason" text,
	CONSTRAINT "push_subscriptions_revoked_reason_check" CHECK ("push_subscriptions"."revoked_reason" IS NULL OR "push_subscriptions"."revoked_reason" IN ('user', 'gone', 'replaced', 'limit'))
);
--> statement-breakpoint
ALTER TABLE "notification_log" ADD CONSTRAINT "notification_log_outlet_id_outlets_id_fk" FOREIGN KEY ("outlet_id") REFERENCES "public"."outlets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_log" ADD CONSTRAINT "notification_log_subscription_id_push_subscriptions_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."push_subscriptions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_prefs" ADD CONSTRAINT "notification_prefs_outlet_id_outlets_id_fk" FOREIGN KEY ("outlet_id") REFERENCES "public"."outlets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_prefs" ADD CONSTRAINT "notification_prefs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "push_subscriptions" ADD CONSTRAINT "push_subscriptions_outlet_id_outlets_id_fk" FOREIGN KEY ("outlet_id") REFERENCES "public"."outlets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "push_subscriptions" ADD CONSTRAINT "push_subscriptions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "notification_log_event_entity_subscription_unique" ON "notification_log" USING btree ("event","entity_id","subscription_id");--> statement-breakpoint
CREATE INDEX "notification_log_pending_idx" ON "notification_log" USING btree ("next_attempt_at") WHERE "notification_log"."status" = 'pending';--> statement-breakpoint
CREATE UNIQUE INDEX "push_subscriptions_endpoint_active_unique" ON "push_subscriptions" USING btree ("endpoint") WHERE "push_subscriptions"."revoked_at" IS NULL;--> statement-breakpoint
CREATE INDEX "push_subscriptions_owner_active_idx" ON "push_subscriptions" USING btree ("outlet_id","user_id") WHERE "push_subscriptions"."revoked_at" IS NULL;