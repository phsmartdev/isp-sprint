CREATE TABLE IF NOT EXISTS "automation_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"automation_id" uuid NOT NULL,
	"opportunity_id" uuid NOT NULL,
	"status" text NOT NULL,
	"detail" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "automation_runs_status_ck" CHECK (status in ('ok','erro','ignorado'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "commission_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"sale_type" text DEFAULT 'qualquer' NOT NULL,
	"min_price_cents" bigint,
	"max_price_cents" bigint,
	"kind" text NOT NULL,
	"percent_bp" integer DEFAULT 0 NOT NULL,
	"multiplier_x100" integer DEFAULT 0 NOT NULL,
	"amount_cents" bigint DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "commission_rules_sale_ck" CHECK (sale_type in ('ativa','receptiva','qualquer')),
	CONSTRAINT "commission_rules_kind_ck" CHECK (kind in ('percent','mensalidades','fixo'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "condominiums" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"region_id" uuid NOT NULL,
	"name" text NOT NULL,
	"cep" text,
	"street" text,
	"number" text,
	"district" text,
	"city" text,
	"blocks" text[] DEFAULT '{}'::text[] NOT NULL,
	"units" integer,
	"has_network" boolean DEFAULT false NOT NULL,
	"notes" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "delivery_routes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"cable_per_meter_cents" bigint DEFAULT 0 NOT NULL,
	"install_cost_cents" bigint DEFAULT 0 NOT NULL,
	"monthly_cost_cents" bigint DEFAULT 0 NOT NULL,
	"requires_approval" boolean DEFAULT false NOT NULL,
	"kit" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "equipment_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"cost_cents" bigint NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "pipeline_automations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"pipeline_id" uuid NOT NULL,
	"name" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"trigger" jsonb NOT NULL,
	"actions" jsonb NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "pipeline_fields" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"pipeline_id" uuid NOT NULL,
	"key" text NOT NULL,
	"label" text NOT NULL,
	"type" text DEFAULT 'texto' NOT NULL,
	"options" text[] DEFAULT '{}'::text[] NOT NULL,
	"required" boolean DEFAULT false NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "pipeline_fields_type_ck" CHECK (type in ('texto','texto_longo','numero','moeda','data','lista','sim_nao'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "pipeline_members" (
	"pipeline_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	CONSTRAINT "pipeline_members_pipeline_id_user_id_pk" PRIMARY KEY("pipeline_id","user_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "regions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "route_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"min_meters" integer,
	"max_meters" integer,
	"min_mbps" integer,
	"max_mbps" integer,
	"route_id" uuid NOT NULL,
	"active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "viability_deductions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"category" text NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"percent_bp" integer DEFAULT 0 NOT NULL,
	"amount_cents" bigint DEFAULT 0 NOT NULL,
	"route_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"notes" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "viability_deductions_cat_ck" CHECK (category in ('tributo','parceiro')),
	CONSTRAINT "viability_deductions_kind_ck" CHECK (kind in ('percent','fixed'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "viability_settings" (
	"tenant_id" uuid PRIMARY KEY NOT NULL,
	"default_route_id" uuid,
	"ltv_lifetime_months" integer,
	"monthly_churn_bp" integer,
	"ltv_min_sample" integer DEFAULT 30 NOT NULL,
	"max_payback_months" integer,
	"default_activation_fee_cents" bigint,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "contract_end" date;--> statement-breakpoint
ALTER TABLE "opportunities" ADD COLUMN "install_cep" text;--> statement-breakpoint
ALTER TABLE "opportunities" ADD COLUMN "install_street" text;--> statement-breakpoint
ALTER TABLE "opportunities" ADD COLUMN "install_number" text;--> statement-breakpoint
ALTER TABLE "opportunities" ADD COLUMN "install_district" text;--> statement-breakpoint
ALTER TABLE "opportunities" ADD COLUMN "install_city" text;--> statement-breakpoint
ALTER TABLE "opportunities" ADD COLUMN "condominium_id" uuid;--> statement-breakpoint
ALTER TABLE "opportunities" ADD COLUMN "install_block" text;--> statement-breakpoint
ALTER TABLE "opportunities" ADD COLUMN "install_unit" text;--> statement-breakpoint
ALTER TABLE "opportunities" ADD COLUMN "sale_type" text;--> statement-breakpoint
ALTER TABLE "opportunities" ADD COLUMN "cable_meters" integer;--> statement-breakpoint
ALTER TABLE "opportunities" ADD COLUMN "activation_fee_cents" bigint;--> statement-breakpoint
ALTER TABLE "opportunities" ADD COLUMN "equipment" jsonb;--> statement-breakpoint
ALTER TABLE "opportunities" ADD COLUMN "route_id" uuid;--> statement-breakpoint
ALTER TABLE "opportunities" ADD COLUMN "viability" jsonb;--> statement-breakpoint
ALTER TABLE "opportunities" ADD COLUMN "commission_cents" bigint;--> statement-breakpoint
ALTER TABLE "opportunities" ADD COLUMN "cac_cents" bigint;--> statement-breakpoint
ALTER TABLE "opportunities" ADD COLUMN "margin_cents" bigint;--> statement-breakpoint
ALTER TABLE "opportunities" ADD COLUMN "payback_months" text;--> statement-breakpoint
ALTER TABLE "opportunities" ADD COLUMN "custom" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "opportunities" ADD COLUMN "duplicated_from_id" uuid;--> statement-breakpoint
ALTER TABLE "plans" ADD COLUMN "speed_mbps" integer;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "automation_runs" ADD CONSTRAINT "automation_runs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "automation_runs" ADD CONSTRAINT "automation_runs_automation_id_pipeline_automations_id_fk" FOREIGN KEY ("automation_id") REFERENCES "public"."pipeline_automations"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "automation_runs" ADD CONSTRAINT "automation_runs_opportunity_id_opportunities_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."opportunities"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "commission_rules" ADD CONSTRAINT "commission_rules_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "condominiums" ADD CONSTRAINT "condominiums_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "condominiums" ADD CONSTRAINT "condominiums_region_id_regions_id_fk" FOREIGN KEY ("region_id") REFERENCES "public"."regions"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "delivery_routes" ADD CONSTRAINT "delivery_routes_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "equipment_items" ADD CONSTRAINT "equipment_items_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "pipeline_automations" ADD CONSTRAINT "pipeline_automations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "pipeline_automations" ADD CONSTRAINT "pipeline_automations_pipeline_id_pipelines_id_fk" FOREIGN KEY ("pipeline_id") REFERENCES "public"."pipelines"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "pipeline_automations" ADD CONSTRAINT "pipeline_automations_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "pipeline_fields" ADD CONSTRAINT "pipeline_fields_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "pipeline_fields" ADD CONSTRAINT "pipeline_fields_pipeline_id_pipelines_id_fk" FOREIGN KEY ("pipeline_id") REFERENCES "public"."pipelines"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "pipeline_members" ADD CONSTRAINT "pipeline_members_pipeline_id_pipelines_id_fk" FOREIGN KEY ("pipeline_id") REFERENCES "public"."pipelines"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "pipeline_members" ADD CONSTRAINT "pipeline_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "regions" ADD CONSTRAINT "regions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "route_rules" ADD CONSTRAINT "route_rules_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "route_rules" ADD CONSTRAINT "route_rules_route_id_delivery_routes_id_fk" FOREIGN KEY ("route_id") REFERENCES "public"."delivery_routes"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "viability_deductions" ADD CONSTRAINT "viability_deductions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "viability_settings" ADD CONSTRAINT "viability_settings_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "viability_settings" ADD CONSTRAINT "viability_settings_default_route_id_delivery_routes_id_fk" FOREIGN KEY ("default_route_id") REFERENCES "public"."delivery_routes"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "viability_settings" ADD CONSTRAINT "viability_settings_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "automation_runs_opp_idx" ON "automation_runs" USING btree ("opportunity_id","automation_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "condominiums_region_idx" ON "condominiums" USING btree ("tenant_id","region_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "pipeline_automations_pipe_idx" ON "pipeline_automations" USING btree ("pipeline_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "pipeline_fields_uq" ON "pipeline_fields" USING btree ("pipeline_id","key");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "regions_uq" ON "regions" USING btree ("tenant_id",lower("name"));--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_condominium_id_condominiums_id_fk" FOREIGN KEY ("condominium_id") REFERENCES "public"."condominiums"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_route_id_delivery_routes_id_fk" FOREIGN KEY ("route_id") REFERENCES "public"."delivery_routes"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
-- Banda inferida do nome dos planos existentes ("500 Mega" → 500). Planos sem número ficam sem banda.
UPDATE "plans" SET "speed_mbps" = (substring(name from '([0-9]+)\s*(Mega|Mbps|MB)'))::int WHERE "speed_mbps" IS NULL AND name ~ '[0-9]+\s*(Mega|Mbps|MB)';--> statement-breakpoint
UPDATE "plans" SET "speed_mbps" = (substring(name from '([0-9]+)\s*(Giga|Gbps|GB)'))::int * 1000 WHERE "speed_mbps" IS NULL AND name ~ '[0-9]+\s*(Giga|Gbps|GB)';
