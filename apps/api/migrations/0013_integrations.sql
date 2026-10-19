CREATE TABLE IF NOT EXISTS "integration_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"status" text NOT NULL,
	"summary" text NOT NULL,
	"lead_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "integrations" (
	"tenant_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"secrets" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"webhook_token" text NOT NULL,
	"last_event_at" timestamp with time zone,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "integrations_tenant_id_kind_pk" PRIMARY KEY("tenant_id","kind"),
	CONSTRAINT "integrations_kind_ck" CHECK (kind in ('ixc','whatsapp','meta','site'))
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "integration_events" ADD CONSTRAINT "integration_events_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "integrations" ADD CONSTRAINT "integrations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "integrations" ADD CONSTRAINT "integrations_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "integration_events_tenant_idx" ON "integration_events" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "integrations_token_uq" ON "integrations" USING btree ("webhook_token");