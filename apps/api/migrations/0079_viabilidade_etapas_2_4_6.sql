CREATE TABLE IF NOT EXISTS "cost_item_prices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"unit_cents" bigint NOT NULL,
	"valid_from" date NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "cost_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"unit" text DEFAULT 'un' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cost_items_kind_ck" CHECK (kind in ('investimento','mensal'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "fiscal_doc_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"doc_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"taxes" jsonb NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "opportunity_economics_snapshots" ADD COLUMN "engine_version" text;--> statement-breakpoint
ALTER TABLE "opportunity_economics_snapshots" ADD COLUMN "settings_version_id" uuid;--> statement-breakpoint
ALTER TABLE "opportunity_economics_snapshots" ADD COLUMN "sha256" text;--> statement-breakpoint
ALTER TABLE "sales_branches" ADD COLUMN "cnpj" text;--> statement-breakpoint
ALTER TABLE "sales_branches" ADD COLUMN "tax_regime" text;--> statement-breakpoint
ALTER TABLE "sales_branches" ADD COLUMN "city" text;--> statement-breakpoint
ALTER TABLE "sales_branches" ADD COLUMN "state" text;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "cost_item_prices" ADD CONSTRAINT "cost_item_prices_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "cost_item_prices" ADD CONSTRAINT "cost_item_prices_item_id_cost_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."cost_items"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "cost_items" ADD CONSTRAINT "cost_items_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "fiscal_doc_versions" ADD CONSTRAINT "fiscal_doc_versions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "fiscal_doc_versions" ADD CONSTRAINT "fiscal_doc_versions_doc_id_fiscal_doc_types_id_fk" FOREIGN KEY ("doc_id") REFERENCES "public"."fiscal_doc_types"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "cost_item_prices_idx" ON "cost_item_prices" USING btree ("item_id","valid_from","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "cost_items_uq" ON "cost_items" USING btree ("tenant_id","kind","name");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "fiscal_doc_versions_uq" ON "fiscal_doc_versions" USING btree ("doc_id","version");--> statement-breakpoint
ALTER TABLE "sales_branches" ADD CONSTRAINT "sales_branches_regime_ck" CHECK (tax_regime is null or tax_regime in ('simples_nacional','lucro_presumido','lucro_real','mei'));--> statement-breakpoint
CREATE TRIGGER fiscal_doc_versions_append_only BEFORE UPDATE OR DELETE ON "fiscal_doc_versions" FOR EACH ROW EXECUTE FUNCTION isp_econ_snapshot_guard();
--> statement-breakpoint
CREATE TRIGGER cost_item_prices_append_only BEFORE UPDATE OR DELETE ON "cost_item_prices" FOR EACH ROW EXECUTE FUNCTION isp_econ_snapshot_guard();
--> statement-breakpoint
-- tributos atuais de cada documento viram a versão 1
INSERT INTO "fiscal_doc_versions" ("tenant_id", "doc_id", "version", "taxes", "created_by", "created_at")
SELECT "tenant_id", "id", 1, "taxes", "updated_by", "updated_at" FROM "fiscal_doc_types";
