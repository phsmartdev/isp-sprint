CREATE TABLE IF NOT EXISTS "contract_commitment_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"commitment_id" uuid NOT NULL,
	"line_id" uuid NOT NULL,
	"item_number" text,
	"code" text,
	"qty4" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "contract_commitment_items_qty_ck" CHECK (qty4 > 0)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "contract_commitment_moves" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"commitment_item_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"qty4" bigint NOT NULL,
	"occurred_on" date NOT NULL,
	"reason" text NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "contract_commitment_moves_kind_ck" CHECK (kind in ('reforco','anulacao')),
	CONSTRAINT "contract_commitment_moves_qty_ck" CHECK (qty4 > 0)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "contract_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"contract_id" uuid NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"item_number" text NOT NULL,
	"arp_item_number" text,
	"arp_item_id" uuid,
	"description" text NOT NULL,
	"unit" text NOT NULL,
	"classification" text DEFAULT 'demanda' NOT NULL,
	"qty4" bigint NOT NULL,
	"price4" bigint DEFAULT 0 NOT NULL,
	"monthly_qty4" bigint,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "contract_lines_class_ck" CHECK (classification in ('demanda','fornecimento','recorrente')),
	CONSTRAINT "contract_lines_qty_ck" CHECK (qty4 >= 0 and price4 >= 0)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "contract_measurement_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"measurement_id" uuid NOT NULL,
	"line_id" uuid NOT NULL,
	"qty4" bigint NOT NULL,
	"price4" bigint NOT NULL,
	"allocations" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"uncovered4" bigint DEFAULT 0 NOT NULL,
	CONSTRAINT "contract_measurement_items_qty_ck" CHECK (qty4 > 0)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "contract_measurements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"contract_id" uuid NOT NULL,
	"group_id" uuid NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"superseded" boolean DEFAULT false NOT NULL,
	"competence" text NOT NULL,
	"kind" text DEFAULT 'avulsa' NOT NULL,
	"title" text NOT NULL,
	"status" text DEFAULT 'elaboracao' NOT NULL,
	"opportunity_id" uuid,
	"revision_reason" text,
	"revision_note" text,
	"invoice_number" text,
	"invoice_date" date,
	"invoice_cents" bigint,
	"attested_at" timestamp with time zone,
	"notes" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "contract_measurements_status_ck" CHECK (status in ('elaboracao','enviada','atestada','faturada','cancelada')),
	CONSTRAINT "contract_measurements_kind_ck" CHECK (kind in ('mensal','avulsa','evento'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "contract_opportunity_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"contract_id" uuid NOT NULL,
	"opportunity_id" uuid NOT NULL,
	"line_id" uuid NOT NULL,
	"qty4" bigint NOT NULL,
	"status" text DEFAULT 'reservada' NOT NULL,
	"measurement_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "contract_opp_lines_status_ck" CHECK (status in ('reservada','medida','liberada'))
);
--> statement-breakpoint
ALTER TABLE "contract_commitments" ADD COLUMN "source" text;--> statement-breakpoint
ALTER TABLE "contract_commitments" ADD COLUMN "replaces_id" uuid;--> statement-breakpoint
ALTER TABLE "contracts" ADD COLUMN "commitment_block" boolean DEFAULT false NOT NULL;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "contract_commitment_items" ADD CONSTRAINT "contract_commitment_items_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "contract_commitment_items" ADD CONSTRAINT "contract_commitment_items_commitment_id_contract_commitments_id_fk" FOREIGN KEY ("commitment_id") REFERENCES "public"."contract_commitments"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "contract_commitment_items" ADD CONSTRAINT "contract_commitment_items_line_id_contract_lines_id_fk" FOREIGN KEY ("line_id") REFERENCES "public"."contract_lines"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "contract_commitment_moves" ADD CONSTRAINT "contract_commitment_moves_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "contract_commitment_moves" ADD CONSTRAINT "contract_commitment_moves_commitment_item_id_contract_commitment_items_id_fk" FOREIGN KEY ("commitment_item_id") REFERENCES "public"."contract_commitment_items"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "contract_lines" ADD CONSTRAINT "contract_lines_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "contract_lines" ADD CONSTRAINT "contract_lines_contract_id_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."contracts"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "contract_measurement_items" ADD CONSTRAINT "contract_measurement_items_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "contract_measurement_items" ADD CONSTRAINT "contract_measurement_items_measurement_id_contract_measurements_id_fk" FOREIGN KEY ("measurement_id") REFERENCES "public"."contract_measurements"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "contract_measurement_items" ADD CONSTRAINT "contract_measurement_items_line_id_contract_lines_id_fk" FOREIGN KEY ("line_id") REFERENCES "public"."contract_lines"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "contract_measurements" ADD CONSTRAINT "contract_measurements_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "contract_measurements" ADD CONSTRAINT "contract_measurements_contract_id_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."contracts"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "contract_measurements" ADD CONSTRAINT "contract_measurements_opportunity_id_opportunities_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."opportunities"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "contract_opportunity_lines" ADD CONSTRAINT "contract_opportunity_lines_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "contract_opportunity_lines" ADD CONSTRAINT "contract_opportunity_lines_contract_id_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."contracts"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "contract_opportunity_lines" ADD CONSTRAINT "contract_opportunity_lines_opportunity_id_opportunities_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."opportunities"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "contract_opportunity_lines" ADD CONSTRAINT "contract_opportunity_lines_line_id_contract_lines_id_fk" FOREIGN KEY ("line_id") REFERENCES "public"."contract_lines"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "contract_commitment_items_uq" ON "contract_commitment_items" USING btree ("commitment_id","line_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "contract_lines_uq" ON "contract_lines" USING btree ("contract_id","item_number",coalesce("arp_item_number", ''));--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "contract_measurement_items_uq" ON "contract_measurement_items" USING btree ("measurement_id","line_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "contract_measurements_idx" ON "contract_measurements" USING btree ("contract_id","competence");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "contract_measurements_grp_uq" ON "contract_measurements" USING btree ("group_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "contract_opp_lines_uq" ON "contract_opportunity_lines" USING btree ("opportunity_id","line_id");