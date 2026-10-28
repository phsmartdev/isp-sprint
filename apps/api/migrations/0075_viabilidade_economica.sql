CREATE TABLE IF NOT EXISTS "fiscal_doc_types" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"sale_kind" text NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"taxes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "opportunity_economics" (
	"opportunity_id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"input" jsonb NOT NULL,
	"result" jsonb NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "opportunity_economics_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"opportunity_id" uuid NOT NULL,
	"input" jsonb NOT NULL,
	"settings" jsonb NOT NULL,
	"result" jsonb NOT NULL,
	"reason" text DEFAULT 'salvo' NOT NULL,
	"actor_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "opportunity_items" ADD COLUMN "fiscal_doc_type_id" uuid;--> statement-breakpoint
ALTER TABLE "plans" ADD COLUMN "fiscal_doc_code" text;--> statement-breakpoint
ALTER TABLE "sales_branches" ADD COLUMN "sale_kinds" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "viability_settings" ADD COLUMN "econ" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "fiscal_doc_types" ADD CONSTRAINT "fiscal_doc_types_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "fiscal_doc_types" ADD CONSTRAINT "fiscal_doc_types_branch_id_sales_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."sales_branches"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "opportunity_economics" ADD CONSTRAINT "opportunity_economics_opportunity_id_opportunities_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."opportunities"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "opportunity_economics" ADD CONSTRAINT "opportunity_economics_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "opportunity_economics_snapshots" ADD CONSTRAINT "opportunity_economics_snapshots_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "opportunity_economics_snapshots" ADD CONSTRAINT "opportunity_economics_snapshots_opportunity_id_opportunities_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."opportunities"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "fiscal_doc_types_uq" ON "fiscal_doc_types" USING btree ("tenant_id","branch_id","sale_kind","code");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "opp_econ_snap_idx" ON "opportunity_economics_snapshots" USING btree ("opportunity_id","created_at");--> statement-breakpoint
-- Fotografia da viabilidade econômica: nunca muda nem some (só a limpeza autorizada da base apaga, junto com a oportunidade).
CREATE OR REPLACE FUNCTION isp_econ_snapshot_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' AND current_setting('isp.allow_purge', true) = 'on' THEN RETURN OLD; END IF;
  RAISE EXCEPTION 'Fotografia da viabilidade econômica é append-only (operação % bloqueada)', TG_OP USING ERRCODE = 'check_violation';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER opportunity_economics_snapshots_append_only BEFORE UPDATE OR DELETE ON "opportunity_economics_snapshots" FOR EACH ROW EXECUTE FUNCTION isp_econ_snapshot_guard();
