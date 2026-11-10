CREATE TABLE IF NOT EXISTS "fiscal_envelopes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"ibge_code" text NOT NULL,
	"municipality" text,
	"year" integer NOT NULL,
	"values" jsonb NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fiscal_envelopes_ibge_ck" CHECK (ibge_code ~ '^[0-9]{7}$'),
	CONSTRAINT "fiscal_envelopes_year_ck" CHECK (year between 2020 and 2100)
);
--> statement-breakpoint
ALTER TABLE "sales_branches" ADD COLUMN "ibge_code" text;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "fiscal_envelopes" ADD CONSTRAINT "fiscal_envelopes_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "fiscal_envelopes" ADD CONSTRAINT "fiscal_envelopes_branch_id_sales_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."sales_branches"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "fiscal_envelopes_idx" ON "fiscal_envelopes" USING btree ("tenant_id","branch_id","ibge_code","year","created_at");--> statement-breakpoint
CREATE TRIGGER fiscal_envelopes_append_only BEFORE UPDATE OR DELETE ON fiscal_envelopes
  FOR EACH ROW EXECUTE FUNCTION isp_forbid_mutation();
