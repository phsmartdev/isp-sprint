CREATE TABLE IF NOT EXISTS "contract_alerts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"contract_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"cycle_key" text NOT NULL,
	"due_at" date,
	"owner_id" uuid,
	"status" text DEFAULT 'aberto' NOT NULL,
	"detail" text,
	"activity_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"emails" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	"resolved_by" uuid,
	"resolution" text,
	CONSTRAINT "contract_alerts_status_ck" CHECK (status in ('aberto','concluido','cancelado'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "contract_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"contract_id" uuid NOT NULL,
	"process_id" uuid,
	"group_id" uuid NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"category" text NOT NULL,
	"name" text NOT NULL,
	"doc_date" date NOT NULL,
	"summary" text NOT NULL,
	"mime" text NOT NULL,
	"size" integer NOT NULL,
	"sha256" text NOT NULL,
	"data" "bytea" NOT NULL,
	"folder" text DEFAULT 'Ativos' NOT NULL,
	"restricted_to" text[] DEFAULT '{}'::text[] NOT NULL,
	"signed" boolean DEFAULT false NOT NULL,
	"uploaded_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"deleted_by" uuid,
	CONSTRAINT "contract_documents_folder_ck" CHECK (folder in ('Ativos','Encerrados'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "contract_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"contract_id" uuid NOT NULL,
	"type" text NOT NULL,
	"actor_id" uuid,
	"summary" text NOT NULL,
	"payload" jsonb,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "contract_processes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"contract_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"cycle_key" text NOT NULL,
	"status" text DEFAULT 'aberto' NOT NULL,
	"steps" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"owner_id" uuid,
	"due_at" date,
	"outcome" text,
	"opened_by" uuid,
	"opened_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_at" timestamp with time zone,
	"closed_by" uuid,
	"row_version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "contract_processes_kind_ck" CHECK (kind in ('implantacao','renovacao','reajuste','encerramento')),
	CONSTRAINT "contract_processes_status_ck" CHECK (status in ('aberto','concluido','cancelado'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "contract_settings" (
	"tenant_id" uuid PRIMARY KEY NOT NULL,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "contract_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"contract_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"change_kind" text DEFAULT 'cadastro' NOT NULL,
	"reason" text,
	"number" text NOT NULL,
	"object" text NOT NULL,
	"signed_at" date,
	"start_at" date,
	"end_at" date,
	"term_months" integer,
	"activation_at" date,
	"billing_start_at" date,
	"renewal_at" date,
	"monthly_cents" bigint DEFAULT 0 NOT NULL,
	"total_cents" bigint,
	"billing_day" integer,
	"billing_terms" text,
	"items" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"guarantee" jsonb,
	"public_terms" jsonb,
	"adjustment_index" text,
	"adjustment_base_date" date,
	"adjustment_rule" text,
	"special_conditions" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "contract_versions_change_ck" CHECK (change_kind in ('cadastro','edicao','ativacao','renovacao','reajuste','encerramento')),
	CONSTRAINT "contract_versions_value_ck" CHECK (monthly_cents >= 0)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "contracts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"code" serial NOT NULL,
	"contact_id" uuid NOT NULL,
	"customer_id" uuid,
	"opportunity_id" uuid,
	"kind" text DEFAULT 'privado' NOT NULL,
	"legal_regime" text DEFAULT 'privado' NOT NULL,
	"stage" text DEFAULT 'cadastro_validacao' NOT NULL,
	"stage_changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"current_version" integer DEFAULT 1 NOT NULL,
	"commercial_owner_id" uuid NOT NULL,
	"operational_owner_id" uuid,
	"csm_id" uuid,
	"validated_at" timestamp with time zone,
	"validated_by" uuid,
	"erp_ref" text,
	"renewed" boolean DEFAULT false NOT NULL,
	"closure_expected" boolean DEFAULT false NOT NULL,
	"closure_reason" text,
	"closure_at" date,
	"legal_limit_at" date,
	"closed_at" timestamp with time zone,
	"archived_at" timestamp with time zone,
	"archive_location" text,
	"archive_responsible_id" uuid,
	"final_note" text,
	"next_action" text,
	"next_action_at" date,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"row_version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "contracts_stage_ck" CHECK (stage in ('cadastro_validacao','implantacao','vigente','renovacao','reajuste','encerramento','arquivado')),
	CONSTRAINT "contracts_kind_ck" CHECK (kind in ('privado','publico')),
	CONSTRAINT "contracts_regime_ck" CHECK (legal_regime in ('privado','lei_8666','lei_14133','outro'))
);
--> statement-breakpoint
ALTER TABLE "access_policies" DROP CONSTRAINT "access_module_ck";--> statement-breakpoint
ALTER TABLE "activities" ADD COLUMN "contract_id" uuid;--> statement-breakpoint
ALTER TABLE "email_messages" ADD COLUMN "contract_id" uuid;--> statement-breakpoint
ALTER TABLE "email_messages" ADD COLUMN "cc_address" text;--> statement-breakpoint
ALTER TABLE "opportunities" ADD COLUMN "handoff_stage" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "sectors" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "contract_alerts" ADD CONSTRAINT "contract_alerts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "contract_alerts" ADD CONSTRAINT "contract_alerts_contract_id_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."contracts"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "contract_alerts" ADD CONSTRAINT "contract_alerts_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "contract_alerts" ADD CONSTRAINT "contract_alerts_resolved_by_users_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "contract_documents" ADD CONSTRAINT "contract_documents_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "contract_documents" ADD CONSTRAINT "contract_documents_contract_id_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."contracts"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "contract_documents" ADD CONSTRAINT "contract_documents_process_id_contract_processes_id_fk" FOREIGN KEY ("process_id") REFERENCES "public"."contract_processes"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "contract_documents" ADD CONSTRAINT "contract_documents_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "contract_events" ADD CONSTRAINT "contract_events_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "contract_events" ADD CONSTRAINT "contract_events_contract_id_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."contracts"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "contract_events" ADD CONSTRAINT "contract_events_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "contract_processes" ADD CONSTRAINT "contract_processes_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "contract_processes" ADD CONSTRAINT "contract_processes_contract_id_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."contracts"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "contract_processes" ADD CONSTRAINT "contract_processes_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "contract_processes" ADD CONSTRAINT "contract_processes_opened_by_users_id_fk" FOREIGN KEY ("opened_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "contract_processes" ADD CONSTRAINT "contract_processes_closed_by_users_id_fk" FOREIGN KEY ("closed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "contract_settings" ADD CONSTRAINT "contract_settings_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "contract_versions" ADD CONSTRAINT "contract_versions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "contract_versions" ADD CONSTRAINT "contract_versions_contract_id_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."contracts"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "contract_versions" ADD CONSTRAINT "contract_versions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "contracts" ADD CONSTRAINT "contracts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "contracts" ADD CONSTRAINT "contracts_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "contracts" ADD CONSTRAINT "contracts_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "contracts" ADD CONSTRAINT "contracts_opportunity_id_opportunities_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."opportunities"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "contracts" ADD CONSTRAINT "contracts_commercial_owner_id_users_id_fk" FOREIGN KEY ("commercial_owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "contracts" ADD CONSTRAINT "contracts_operational_owner_id_users_id_fk" FOREIGN KEY ("operational_owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "contracts" ADD CONSTRAINT "contracts_csm_id_users_id_fk" FOREIGN KEY ("csm_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "contracts" ADD CONSTRAINT "contracts_validated_by_users_id_fk" FOREIGN KEY ("validated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "contracts" ADD CONSTRAINT "contracts_archive_responsible_id_users_id_fk" FOREIGN KEY ("archive_responsible_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "contracts" ADD CONSTRAINT "contracts_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "contract_alerts_uq" ON "contract_alerts" USING btree ("contract_id","kind","cycle_key");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "contract_alerts_open_idx" ON "contract_alerts" USING btree ("tenant_id","status","due_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "contract_documents_idx" ON "contract_documents" USING btree ("tenant_id","contract_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "contract_documents_group_uq" ON "contract_documents" USING btree ("group_id","version");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "contract_events_idx" ON "contract_events" USING btree ("tenant_id","contract_id","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "contract_processes_uq" ON "contract_processes" USING btree ("contract_id","kind","cycle_key");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "contract_versions_uq" ON "contract_versions" USING btree ("contract_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "contracts_code_uq" ON "contracts" USING btree ("code");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "contracts_opp_uq" ON "contracts" USING btree ("opportunity_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "contracts_tenant_stage_idx" ON "contracts" USING btree ("tenant_id","stage");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "contracts_contact_idx" ON "contracts" USING btree ("tenant_id","contact_id");--> statement-breakpoint
ALTER TABLE "access_policies" ADD CONSTRAINT "access_module_ck" CHECK (module in ('inicio','leads','oportunidades','clientes','atividades','relatorios','campanhas','contratos','inteligencia','configuracoes'));--> statement-breakpoint
CREATE OR REPLACE FUNCTION isp_forbid_mutation() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE'
     AND TG_TABLE_NAME IN ('opportunity_events', 'activity_events', 'email_messages', 'contract_events', 'contract_versions')
     AND current_setting('isp.allow_purge', true) = 'on' THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'Tabela % é append-only (operação % bloqueada)', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'check_violation';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER contract_versions_append_only BEFORE UPDATE OR DELETE ON "contract_versions" FOR EACH ROW EXECUTE FUNCTION isp_forbid_mutation();
--> statement-breakpoint
CREATE TRIGGER contract_events_append_only BEFORE UPDATE OR DELETE ON "contract_events" FOR EACH ROW EXECUTE FUNCTION isp_forbid_mutation();
--> statement-breakpoint
INSERT INTO access_policies (role_id, module, level)
SELECT r.id, 'contratos', CASE r.key WHEN 'gerencia' THEN 'total' WHEN 'supervisor' THEN 'equipe' ELSE 'proprio' END
FROM roles r
ON CONFLICT DO NOTHING;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "activities_contract_idx" ON "activities" ("tenant_id", "contract_id");
