CREATE TABLE IF NOT EXISTS "contract_adjustment_retros" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"contract_id" uuid NOT NULL,
	"adjustment_id" uuid NOT NULL,
	"measurement_id" uuid NOT NULL,
	"items" jsonb NOT NULL,
	"diff_v4" bigint NOT NULL,
	"status" text DEFAULT 'pendente' NOT NULL,
	"invoice_number" text,
	"invoice_date" date,
	"invoice_cents" bigint,
	"invoiced_by" uuid,
	"invoiced_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "contract_adjustment_retros_status_ck" CHECK (status in ('pendente','faturado'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "contract_adjustments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"contract_id" uuid NOT NULL,
	"index_name" text NOT NULL,
	"mode" text NOT NULL,
	"input_text" text NOT NULL,
	"factor8" bigint NOT NULL,
	"base_date" date NOT NULL,
	"start_competence" text NOT NULL,
	"note" text,
	"repriced" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "contract_adjustments_mode_ck" CHECK (mode in ('fator','percentual')),
	CONSTRAINT "contract_adjustments_factor_ck" CHECK (factor8 > 0)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "contract_line_moves" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"contract_id" uuid NOT NULL,
	"line_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"qty4" bigint NOT NULL,
	"effective_on" date NOT NULL,
	"reason" text NOT NULL,
	"reference" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "contract_line_moves_kind_ck" CHECK (kind in ('acrescimo','supressao')),
	CONSTRAINT "contract_line_moves_qty_ck" CHECK (qty4 > 0)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "contract_line_prices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"adjustment_id" uuid NOT NULL,
	"line_id" uuid NOT NULL,
	"from_competence" text NOT NULL,
	"previous_price4" bigint NOT NULL,
	"price4" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "contract_revenue_sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"contract_id" uuid NOT NULL,
	"name" text NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "contract_source_shares" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"contract_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"valid_from" text NOT NULL,
	"defined_by" text NOT NULL,
	"shares" jsonb NOT NULL,
	"note" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "contract_source_shares_by_ck" CHECK (defined_by in ('cliente','bk'))
);
--> statement-breakpoint
ALTER TABLE "contract_commitment_moves" DROP CONSTRAINT "contract_commitment_moves_kind_ck";--> statement-breakpoint
ALTER TABLE "contract_commitment_moves" ADD COLUMN "linked_commitment_id" uuid;--> statement-breakpoint
ALTER TABLE "contract_commitments" ADD COLUMN "source_id" uuid;--> statement-breakpoint
ALTER TABLE "contracts" ADD COLUMN "commitment_allocation" text DEFAULT 'fifo' NOT NULL;--> statement-breakpoint
ALTER TABLE "contracts" ADD COLUMN "commitment_allocation_by" uuid;--> statement-breakpoint
ALTER TABLE "contracts" ADD COLUMN "commitment_allocation_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "contracts" ADD COLUMN "commitment_aging_days" integer DEFAULT 60 NOT NULL;--> statement-breakpoint
ALTER TABLE "contracts" ADD COLUMN "commitment_to_commit_pct" integer;--> statement-breakpoint
ALTER TABLE "contracts" ADD COLUMN "commitment_window_months" integer DEFAULT 3 NOT NULL;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "contract_adjustment_retros" ADD CONSTRAINT "contract_adjustment_retros_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "contract_adjustment_retros" ADD CONSTRAINT "contract_adjustment_retros_contract_id_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."contracts"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "contract_adjustment_retros" ADD CONSTRAINT "contract_adjustment_retros_adjustment_id_contract_adjustments_id_fk" FOREIGN KEY ("adjustment_id") REFERENCES "public"."contract_adjustments"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "contract_adjustment_retros" ADD CONSTRAINT "contract_adjustment_retros_measurement_id_contract_measurements_id_fk" FOREIGN KEY ("measurement_id") REFERENCES "public"."contract_measurements"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "contract_adjustments" ADD CONSTRAINT "contract_adjustments_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "contract_adjustments" ADD CONSTRAINT "contract_adjustments_contract_id_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."contracts"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "contract_line_moves" ADD CONSTRAINT "contract_line_moves_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "contract_line_moves" ADD CONSTRAINT "contract_line_moves_contract_id_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."contracts"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "contract_line_moves" ADD CONSTRAINT "contract_line_moves_line_id_contract_lines_id_fk" FOREIGN KEY ("line_id") REFERENCES "public"."contract_lines"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "contract_line_prices" ADD CONSTRAINT "contract_line_prices_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "contract_line_prices" ADD CONSTRAINT "contract_line_prices_adjustment_id_contract_adjustments_id_fk" FOREIGN KEY ("adjustment_id") REFERENCES "public"."contract_adjustments"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "contract_line_prices" ADD CONSTRAINT "contract_line_prices_line_id_contract_lines_id_fk" FOREIGN KEY ("line_id") REFERENCES "public"."contract_lines"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "contract_revenue_sources" ADD CONSTRAINT "contract_revenue_sources_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "contract_revenue_sources" ADD CONSTRAINT "contract_revenue_sources_contract_id_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."contracts"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "contract_source_shares" ADD CONSTRAINT "contract_source_shares_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "contract_source_shares" ADD CONSTRAINT "contract_source_shares_contract_id_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."contracts"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "contract_adjustment_retros_uq" ON "contract_adjustment_retros" USING btree ("adjustment_id","measurement_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "contract_line_prices_uq" ON "contract_line_prices" USING btree ("adjustment_id","line_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "contract_revenue_sources_uq" ON "contract_revenue_sources" USING btree ("contract_id",lower("name"));--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "contract_source_shares_uq" ON "contract_source_shares" USING btree ("contract_id","version");--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "contract_commitments" ADD CONSTRAINT "contract_commitments_source_id_contract_revenue_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."contract_revenue_sources"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
ALTER TABLE "contract_commitment_moves" ADD CONSTRAINT "contract_commitment_moves_kind_ck" CHECK (kind in ('reforco','anulacao','supressao'));