CREATE TABLE IF NOT EXISTS "bid_actions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"opportunity_id" uuid NOT NULL,
	"company" text NOT NULL,
	"document" text,
	"is_us" boolean DEFAULT false NOT NULL,
	"kind" text NOT NULL,
	"lot" text,
	"amount_cents" bigint,
	"description" text,
	"occurred_at" timestamp with time zone NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "bid_actions" ADD CONSTRAINT "bid_actions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "bid_actions" ADD CONSTRAINT "bid_actions_opportunity_id_opportunities_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."opportunities"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "bid_actions" ADD CONSTRAINT "bid_actions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bid_actions_opp_idx" ON "bid_actions" USING btree ("opportunity_id","occurred_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bid_actions_doc_idx" ON "bid_actions" USING btree ("tenant_id","document");