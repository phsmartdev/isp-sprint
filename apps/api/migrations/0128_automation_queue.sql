CREATE TABLE IF NOT EXISTS "automation_queue" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"opportunity_id" uuid NOT NULL,
	"event" jsonb NOT NULL,
	"dedupe_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone,
	"error" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "email_opens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"email_message_id" uuid NOT NULL,
	"user_agent" text,
	"opened_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ixc_os_watch" (
	"tenant_id" uuid NOT NULL,
	"contact_id" uuid NOT NULL,
	"os_id" text NOT NULL,
	"status" text NOT NULL,
	"fingerprint" text NOT NULL,
	"seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "email_messages" ADD COLUMN "open_token" text;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "automation_queue" ADD CONSTRAINT "automation_queue_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "automation_queue" ADD CONSTRAINT "automation_queue_opportunity_id_opportunities_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."opportunities"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "email_opens" ADD CONSTRAINT "email_opens_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "email_opens" ADD CONSTRAINT "email_opens_email_message_id_email_messages_id_fk" FOREIGN KEY ("email_message_id") REFERENCES "public"."email_messages"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ixc_os_watch" ADD CONSTRAINT "ixc_os_watch_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ixc_os_watch" ADD CONSTRAINT "ixc_os_watch_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "automation_queue_uq" ON "automation_queue" USING btree ("tenant_id","dedupe_key");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "automation_queue_pending_idx" ON "automation_queue" USING btree ("tenant_id","processed_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "email_opens_msg_idx" ON "email_opens" USING btree ("email_message_id","opened_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ixc_os_watch_pk" ON "ixc_os_watch" USING btree ("tenant_id","contact_id","os_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "email_messages_open_token_uq" ON "email_messages" USING btree ("open_token");