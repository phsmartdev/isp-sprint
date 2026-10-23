CREATE TABLE IF NOT EXISTS "opportunity_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"opportunity_id" uuid NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"description" text NOT NULL,
	"unit" text DEFAULT 'un' NOT NULL,
	"qty_milli" bigint NOT NULL,
	"unit_cents" bigint NOT NULL,
	"discount_cents" bigint DEFAULT 0 NOT NULL,
	"surcharge_cents" bigint DEFAULT 0 NOT NULL,
	"notes" text,
	"bid_unit_cents" bigint,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "opportunity_items_unit_ck" CHECK (unit in ('un','km','rs','h'))
);
--> statement-breakpoint
ALTER TABLE "opportunities" ADD COLUMN "bid_mode" text;--> statement-breakpoint
ALTER TABLE "opportunities" ADD COLUMN "bid_global_cents" bigint;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "opportunity_items" ADD CONSTRAINT "opportunity_items_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "opportunity_items" ADD CONSTRAINT "opportunity_items_opportunity_id_opportunities_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."opportunities"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "opportunity_items" ADD CONSTRAINT "opportunity_items_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "opportunity_items_opp_idx" ON "opportunity_items" USING btree ("opportunity_id");