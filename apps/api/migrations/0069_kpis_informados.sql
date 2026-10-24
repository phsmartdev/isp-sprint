CREATE TABLE IF NOT EXISTS "indicator_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"indicator_id" uuid NOT NULL,
	"period" text NOT NULL,
	"period_start" date NOT NULL,
	"value" double precision NOT NULL,
	"note" text,
	"source" text DEFAULT 'informado' NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"superseded_at" timestamp with time zone,
	"superseded_by" uuid
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "indicator_entries" ADD CONSTRAINT "indicator_entries_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "indicator_entries" ADD CONSTRAINT "indicator_entries_indicator_id_indicators_id_fk" FOREIGN KEY ("indicator_id") REFERENCES "public"."indicators"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "indicator_entries" ADD CONSTRAINT "indicator_entries_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "indicator_entries_idx" ON "indicator_entries" USING btree ("tenant_id","indicator_id","period_start");