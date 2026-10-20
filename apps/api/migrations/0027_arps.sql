CREATE TABLE IF NOT EXISTS "arp_adhesions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"arp_id" uuid NOT NULL,
	"agency_id" uuid NOT NULL,
	"requested_at" date NOT NULL,
	"justification" text NOT NULL,
	"items" jsonb NOT NULL,
	"status" text DEFAULT 'solicitada' NOT NULL,
	"supplier_accepted_at" timestamp with time zone,
	"supplier_accepted_by" uuid,
	"manager_authorized_at" timestamp with time zone,
	"manager_authorization_ref" text,
	"authorized_by" uuid,
	"deadline_at" date,
	"opportunity_id" uuid,
	"contract_id" uuid,
	"limits_snapshot" jsonb,
	"rule_version" integer,
	"exception" jsonb,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"row_version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "arp_adhesions_status_ck" CHECK (status in ('solicitada','aceita_fornecedor','autorizada','contratada','recusada','expirada','cancelada'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "arp_agencies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"arp_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"document" text,
	"contact_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "arp_agencies_kind_ck" CHECK (kind in ('gerenciador','participante','nao_participante'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "arp_allocations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"arp_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"agency_id" uuid NOT NULL,
	"qty_milli" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "arp_allocations_qty_ck" CHECK (qty_milli > 0)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "arp_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"arp_id" uuid NOT NULL,
	"category" text NOT NULL,
	"name" text NOT NULL,
	"mime" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"sha256" text NOT NULL,
	"data" "bytea" NOT NULL,
	"adhesion_id" uuid,
	"operation_id" uuid,
	"opportunity_id" uuid,
	"uploaded_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "arp_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"arp_id" uuid NOT NULL,
	"type" text NOT NULL,
	"summary" text NOT NULL,
	"actor_id" uuid,
	"payload" jsonb,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "arp_import_mappings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"mapping" jsonb NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "arp_item_changes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"field" text NOT NULL,
	"from_value" text,
	"to_value" text,
	"reason" text NOT NULL,
	"origin" text NOT NULL,
	"document_id" uuid,
	"operation_id" uuid,
	"actor_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "arp_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"arp_id" uuid NOT NULL,
	"item_number" text NOT NULL,
	"lot" text,
	"code" text,
	"description" text NOT NULL,
	"specification" text,
	"unit" text NOT NULL,
	"registered_milli" bigint NOT NULL,
	"unit_cents" bigint NOT NULL,
	"brand_model" text,
	"notes" text,
	"extra" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "arp_items_qty_ck" CHECK (registered_milli > 0 and unit_cents > 0)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "arp_ledger" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"arp_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"agency_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"dir" text,
	"qty_milli" bigint NOT NULL,
	"unit" text NOT NULL,
	"unit_cents" bigint NOT NULL,
	"amount_cents" bigint NOT NULL,
	"origin" text NOT NULL,
	"opportunity_id" uuid,
	"contract_id" uuid,
	"adhesion_id" uuid,
	"operation_id" uuid,
	"document_id" uuid,
	"actor_id" uuid,
	"justification" text,
	"approval_ref" text,
	"rule_version" integer DEFAULT 0 NOT NULL,
	"reverses_id" uuid,
	"idempotency_key" text NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "arp_ledger_kind_ck" CHECK (kind in ('reserva','liberacao','consumo','estorno','remanejamento','conversao_proposta','conversao','ajuste','cancelamento','adesao','execucao','faturamento')),
	CONSTRAINT "arp_ledger_dir_ck" CHECK (dir is null or dir in ('saida','entrada'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "arp_operations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"arp_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"status" text DEFAULT 'solicitada' NOT NULL,
	"input" jsonb NOT NULL,
	"simulation" jsonb NOT NULL,
	"justification" text NOT NULL,
	"document_id" uuid,
	"requested_by" uuid NOT NULL,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"decision_note" text,
	"effected_by" uuid,
	"effected_at" timestamp with time zone,
	"rule_version" integer DEFAULT 0 NOT NULL,
	"exception" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"row_version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "arp_operations_kind_ck" CHECK (kind in ('conversao','remanejamento','correcao','alteracao_preco','cancelamento')),
	CONSTRAINT "arp_operations_status_ck" CHECK (status in ('solicitada','aprovada','reprovada','efetivada','cancelada'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "arp_opportunity_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"arp_id" uuid NOT NULL,
	"opportunity_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"agency_id" uuid NOT NULL,
	"qty_milli" bigint NOT NULL,
	"unit_cents" bigint NOT NULL,
	"status" text DEFAULT 'reservada' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "arp_opp_lines_status_ck" CHECK (status in ('reservada','formalizada','liberada'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "arp_rule_sets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"regime" text NOT NULL,
	"version" integer NOT NULL,
	"rules" jsonb NOT NULL,
	"note" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "arps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"number" text NOT NULL,
	"object" text NOT NULL,
	"process_number" text,
	"regime" text DEFAULT 'federal' NOT NULL,
	"supplier_name" text NOT NULL,
	"supplier_document" text,
	"status" text DEFAULT 'rascunho' NOT NULL,
	"signed_at" date,
	"start_at" date,
	"end_at" date,
	"owner_id" uuid NOT NULL,
	"notes" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"row_version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "arps_status_ck" CHECK (status in ('rascunho','vigente','encerrada','cancelada')),
	CONSTRAINT "arps_regime_ck" CHECK (regime in ('federal','estadual','municipal','distrital','estatal'))
);
--> statement-breakpoint
ALTER TABLE "contracts" ADD COLUMN "arp_id" uuid;--> statement-breakpoint
ALTER TABLE "opportunities" ADD COLUMN "arp_id" uuid;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "arp_adhesions" ADD CONSTRAINT "arp_adhesions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "arp_adhesions" ADD CONSTRAINT "arp_adhesions_arp_id_arps_id_fk" FOREIGN KEY ("arp_id") REFERENCES "public"."arps"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "arp_adhesions" ADD CONSTRAINT "arp_adhesions_agency_id_arp_agencies_id_fk" FOREIGN KEY ("agency_id") REFERENCES "public"."arp_agencies"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "arp_adhesions" ADD CONSTRAINT "arp_adhesions_supplier_accepted_by_users_id_fk" FOREIGN KEY ("supplier_accepted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "arp_adhesions" ADD CONSTRAINT "arp_adhesions_authorized_by_users_id_fk" FOREIGN KEY ("authorized_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "arp_adhesions" ADD CONSTRAINT "arp_adhesions_opportunity_id_opportunities_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."opportunities"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "arp_adhesions" ADD CONSTRAINT "arp_adhesions_contract_id_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."contracts"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "arp_adhesions" ADD CONSTRAINT "arp_adhesions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "arp_agencies" ADD CONSTRAINT "arp_agencies_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "arp_agencies" ADD CONSTRAINT "arp_agencies_arp_id_arps_id_fk" FOREIGN KEY ("arp_id") REFERENCES "public"."arps"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "arp_agencies" ADD CONSTRAINT "arp_agencies_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "arp_allocations" ADD CONSTRAINT "arp_allocations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "arp_allocations" ADD CONSTRAINT "arp_allocations_arp_id_arps_id_fk" FOREIGN KEY ("arp_id") REFERENCES "public"."arps"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "arp_allocations" ADD CONSTRAINT "arp_allocations_item_id_arp_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."arp_items"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "arp_allocations" ADD CONSTRAINT "arp_allocations_agency_id_arp_agencies_id_fk" FOREIGN KEY ("agency_id") REFERENCES "public"."arp_agencies"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "arp_documents" ADD CONSTRAINT "arp_documents_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "arp_documents" ADD CONSTRAINT "arp_documents_arp_id_arps_id_fk" FOREIGN KEY ("arp_id") REFERENCES "public"."arps"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "arp_documents" ADD CONSTRAINT "arp_documents_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "arp_events" ADD CONSTRAINT "arp_events_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "arp_events" ADD CONSTRAINT "arp_events_arp_id_arps_id_fk" FOREIGN KEY ("arp_id") REFERENCES "public"."arps"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "arp_events" ADD CONSTRAINT "arp_events_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "arp_import_mappings" ADD CONSTRAINT "arp_import_mappings_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "arp_import_mappings" ADD CONSTRAINT "arp_import_mappings_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "arp_item_changes" ADD CONSTRAINT "arp_item_changes_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "arp_item_changes" ADD CONSTRAINT "arp_item_changes_item_id_arp_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."arp_items"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "arp_item_changes" ADD CONSTRAINT "arp_item_changes_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "arp_items" ADD CONSTRAINT "arp_items_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "arp_items" ADD CONSTRAINT "arp_items_arp_id_arps_id_fk" FOREIGN KEY ("arp_id") REFERENCES "public"."arps"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "arp_ledger" ADD CONSTRAINT "arp_ledger_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "arp_ledger" ADD CONSTRAINT "arp_ledger_arp_id_arps_id_fk" FOREIGN KEY ("arp_id") REFERENCES "public"."arps"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "arp_ledger" ADD CONSTRAINT "arp_ledger_item_id_arp_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."arp_items"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "arp_ledger" ADD CONSTRAINT "arp_ledger_agency_id_arp_agencies_id_fk" FOREIGN KEY ("agency_id") REFERENCES "public"."arp_agencies"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "arp_ledger" ADD CONSTRAINT "arp_ledger_opportunity_id_opportunities_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."opportunities"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "arp_ledger" ADD CONSTRAINT "arp_ledger_contract_id_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."contracts"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "arp_ledger" ADD CONSTRAINT "arp_ledger_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "arp_operations" ADD CONSTRAINT "arp_operations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "arp_operations" ADD CONSTRAINT "arp_operations_arp_id_arps_id_fk" FOREIGN KEY ("arp_id") REFERENCES "public"."arps"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "arp_operations" ADD CONSTRAINT "arp_operations_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "arp_operations" ADD CONSTRAINT "arp_operations_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "arp_operations" ADD CONSTRAINT "arp_operations_effected_by_users_id_fk" FOREIGN KEY ("effected_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "arp_opportunity_lines" ADD CONSTRAINT "arp_opportunity_lines_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "arp_opportunity_lines" ADD CONSTRAINT "arp_opportunity_lines_arp_id_arps_id_fk" FOREIGN KEY ("arp_id") REFERENCES "public"."arps"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "arp_opportunity_lines" ADD CONSTRAINT "arp_opportunity_lines_opportunity_id_opportunities_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."opportunities"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "arp_opportunity_lines" ADD CONSTRAINT "arp_opportunity_lines_item_id_arp_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."arp_items"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "arp_opportunity_lines" ADD CONSTRAINT "arp_opportunity_lines_agency_id_arp_agencies_id_fk" FOREIGN KEY ("agency_id") REFERENCES "public"."arp_agencies"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "arp_rule_sets" ADD CONSTRAINT "arp_rule_sets_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "arp_rule_sets" ADD CONSTRAINT "arp_rule_sets_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "arps" ADD CONSTRAINT "arps_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "arps" ADD CONSTRAINT "arps_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "arps" ADD CONSTRAINT "arps_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "arp_adhesions_idx" ON "arp_adhesions" USING btree ("arp_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "arp_agencies_uq" ON "arp_agencies" USING btree ("arp_id",lower("name"));--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "arp_allocations_uq" ON "arp_allocations" USING btree ("item_id","agency_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "arp_documents_idx" ON "arp_documents" USING btree ("arp_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "arp_events_idx" ON "arp_events" USING btree ("arp_id","occurred_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "arp_item_changes_idx" ON "arp_item_changes" USING btree ("item_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "arp_items_uq" ON "arp_items" USING btree ("arp_id",lower(coalesce("lot", '')),lower("item_number"));--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "arp_ledger_idem_uq" ON "arp_ledger" USING btree ("tenant_id","idempotency_key");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "arp_ledger_arp_idx" ON "arp_ledger" USING btree ("arp_id","occurred_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "arp_ledger_opp_idx" ON "arp_ledger" USING btree ("opportunity_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "arp_operations_idx" ON "arp_operations" USING btree ("arp_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "arp_opp_lines_uq" ON "arp_opportunity_lines" USING btree ("opportunity_id","item_id","agency_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "arp_rule_sets_uq" ON "arp_rule_sets" USING btree ("tenant_id","regime","version");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "arps_number_uq" ON "arps" USING btree ("tenant_id",lower("number"));--> statement-breakpoint
CREATE OR REPLACE FUNCTION isp_forbid_mutation() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE'
     AND TG_TABLE_NAME IN ('opportunity_events', 'activity_events', 'email_messages', 'contract_events', 'contract_versions', 'contract_ledger',
                           'contact_classifications', 'contact_identity_links', 'approval_requests', 'approval_decisions', 'negotiation_messages',
                           'arp_rule_sets', 'arp_item_changes', 'arp_ledger', 'arp_documents', 'arp_events')
     AND current_setting('isp.allow_purge', true) = 'on' THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'Tabela % é append-only (operação % bloqueada)', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'check_violation';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER arp_rule_sets_append_only BEFORE UPDATE OR DELETE ON "arp_rule_sets" FOR EACH ROW EXECUTE FUNCTION isp_forbid_mutation();
--> statement-breakpoint
CREATE TRIGGER arp_item_changes_append_only BEFORE UPDATE OR DELETE ON "arp_item_changes" FOR EACH ROW EXECUTE FUNCTION isp_forbid_mutation();
--> statement-breakpoint
CREATE TRIGGER arp_ledger_append_only BEFORE UPDATE OR DELETE ON "arp_ledger" FOR EACH ROW EXECUTE FUNCTION isp_forbid_mutation();
--> statement-breakpoint
CREATE TRIGGER arp_documents_append_only BEFORE UPDATE OR DELETE ON "arp_documents" FOR EACH ROW EXECUTE FUNCTION isp_forbid_mutation();
--> statement-breakpoint
CREATE TRIGGER arp_events_append_only BEFORE UPDATE OR DELETE ON "arp_events" FOR EACH ROW EXECUTE FUNCTION isp_forbid_mutation();
