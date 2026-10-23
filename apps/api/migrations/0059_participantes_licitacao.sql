CREATE TABLE IF NOT EXISTS "bid_participants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"opportunity_id" uuid NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"company" text NOT NULL,
	"document" text,
	"lot" text DEFAULT 'Único' NOT NULL,
	"bid_cents" bigint,
	"status" text DEFAULT 'ativo' NOT NULL,
	"winner" boolean DEFAULT false NOT NULL,
	"is_us" boolean DEFAULT false NOT NULL,
	"notes" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bid_participants_status_ck" CHECK (status in ('ativo','desclassificado','desistente'))
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "bid_participants" ADD CONSTRAINT "bid_participants_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "bid_participants" ADD CONSTRAINT "bid_participants_opportunity_id_opportunities_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."opportunities"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "bid_participants" ADD CONSTRAINT "bid_participants_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bid_participants_opp_idx" ON "bid_participants" USING btree ("opportunity_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bid_participants_doc_idx" ON "bid_participants" USING btree ("tenant_id","document");