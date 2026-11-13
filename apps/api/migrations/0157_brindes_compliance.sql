CREATE TABLE IF NOT EXISTS "gift_compliance_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"code" text NOT NULL,
	"version" integer NOT NULL,
	"period_from" date NOT NULL,
	"period_to" date NOT NULL,
	"filters" jsonb NOT NULL,
	"analysis" text,
	"conclusion" text,
	"refs" jsonb NOT NULL,
	"totals" jsonb NOT NULL,
	"letterhead" boolean DEFAULT false NOT NULL,
	"pdf" "bytea" NOT NULL,
	"sha256" text NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "gift_compliance_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"rule_key" text NOT NULL,
	"version" integer NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"param" text NOT NULL,
	"control_type" text NOT NULL,
	"approver_level" text DEFAULT 'gerencia' NOT NULL,
	"limit_value" integer,
	"window_days" integer,
	"allowed_kit_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"allowed_item_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"kinds" text[] DEFAULT '{}'::text[] NOT NULL,
	"natures" text[] DEFAULT '{}'::text[] NOT NULL,
	"segments" text[] DEFAULT '{}'::text[] NOT NULL,
	"purposes" text[] DEFAULT '{}'::text[] NOT NULL,
	"valid_from" date NOT NULL,
	"valid_to" date,
	"active" boolean DEFAULT true NOT NULL,
	"change_note" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "gift_compliance_rules_param_ck" CHECK (param in ('valor_por_concessao','valor_acumulado_conta','valor_periodo','quantidade_itens','composicao_kit','frequencia_conta','orcamento_disponivel','condicao')),
	CONSTRAINT "gift_compliance_rules_ctrl_ck" CHECK (control_type in ('orientativa','autorizacao','restricao')),
	CONSTRAINT "gift_compliance_rules_level_ck" CHECK (approver_level in ('gerencia','diretoria'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "gift_compliance_settings" (
	"tenant_id" uuid PRIMARY KEY NOT NULL,
	"segregation" boolean DEFAULT true NOT NULL,
	"conforming_level" text DEFAULT 'gerencia' NOT NULL,
	"channels" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"policy_note" text,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "gift_compliance_settings_level_ck" CHECK (conforming_level in ('gerencia','diretoria'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "gift_request_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"request_id" uuid NOT NULL,
	"contact_id" uuid NOT NULL,
	"share_cents" integer NOT NULL,
	CONSTRAINT "gift_request_accounts_share_ck" CHECK ("gift_request_accounts"."share_cents" >= 0)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "gift_request_decisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"request_id" uuid NOT NULL,
	"decision" text NOT NULL,
	"decider_id" uuid NOT NULL,
	"profile" text NOT NULL,
	"level" text NOT NULL,
	"outcome" text NOT NULL,
	"findings" jsonb NOT NULL,
	"requester_justification" text NOT NULL,
	"reason" text,
	"conditions" text,
	"amount_cents" integer NOT NULL,
	"request_version" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "gift_request_decisions_ck" CHECK (decision in ('aprovar','aprovar_excecao','ajustes','rejeitar'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "gift_request_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"request_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"mime" text NOT NULL,
	"size" integer NOT NULL,
	"data" "bytea" NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "gift_request_documents_kind_ck" CHECK (kind in ('evidencia','comprovante','autorizacao','entrega','outro'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "gift_request_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"request_id" uuid NOT NULL,
	"type" text NOT NULL,
	"text" text NOT NULL,
	"data" jsonb,
	"actor_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "gift_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"code" text NOT NULL,
	"requester_id" uuid NOT NULL,
	"org_unit_id" uuid,
	"kind" text NOT NULL,
	"purpose" text DEFAULT 'relacionamento' NOT NULL,
	"institutional_class" text,
	"campaign_id" uuid,
	"opportunity_id" uuid,
	"event_name" text,
	"description" text NOT NULL,
	"justification" text NOT NULL,
	"planned_on" date NOT NULL,
	"kit_id" uuid,
	"kits" integer DEFAULT 0 NOT NULL,
	"items" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"estimated_cents" integer NOT NULL,
	"cost_center_id" uuid,
	"budget_line_id" uuid,
	"state" text DEFAULT 'solicitado' NOT NULL,
	"evaluation" jsonb NOT NULL,
	"outcome" text NOT NULL,
	"approved_cents" integer,
	"exception" boolean DEFAULT false NOT NULL,
	"reserved_at" timestamp with time zone,
	"executed_on" date,
	"executed_cents" integer,
	"executor_id" uuid,
	"delivery_id" uuid,
	"cancel_reason" text,
	"row_version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "gift_requests_kind_ck" CHECK (kind in ('brinde','kit','material','apoio_evento','patrocinio_financeiro','patrocinio_produto','outro')),
	CONSTRAINT "gift_requests_purpose_ck" CHECK (purpose in ('relacionamento','abm','oportunidade','campanha','evento','institucional')),
	CONSTRAINT "gift_requests_state_ck" CHECK (state in ('solicitado','ajustes','aprovado','reservado','executado','rejeitado','cancelado')),
	CONSTRAINT "gift_requests_outcome_ck" CHECK (outcome in ('conforme','autorizacao','excecao','impedido')),
	CONSTRAINT "gift_requests_value_ck" CHECK ("gift_requests"."estimated_cents" >= 0)
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "gift_compliance_reports" ADD CONSTRAINT "gift_compliance_reports_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "gift_compliance_reports" ADD CONSTRAINT "gift_compliance_reports_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "gift_compliance_rules" ADD CONSTRAINT "gift_compliance_rules_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "gift_compliance_rules" ADD CONSTRAINT "gift_compliance_rules_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "gift_compliance_settings" ADD CONSTRAINT "gift_compliance_settings_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "gift_compliance_settings" ADD CONSTRAINT "gift_compliance_settings_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "gift_request_accounts" ADD CONSTRAINT "gift_request_accounts_request_id_gift_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."gift_requests"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "gift_request_accounts" ADD CONSTRAINT "gift_request_accounts_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "gift_request_decisions" ADD CONSTRAINT "gift_request_decisions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "gift_request_decisions" ADD CONSTRAINT "gift_request_decisions_request_id_gift_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."gift_requests"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "gift_request_decisions" ADD CONSTRAINT "gift_request_decisions_decider_id_users_id_fk" FOREIGN KEY ("decider_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "gift_request_documents" ADD CONSTRAINT "gift_request_documents_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "gift_request_documents" ADD CONSTRAINT "gift_request_documents_request_id_gift_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."gift_requests"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "gift_request_documents" ADD CONSTRAINT "gift_request_documents_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "gift_request_events" ADD CONSTRAINT "gift_request_events_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "gift_request_events" ADD CONSTRAINT "gift_request_events_request_id_gift_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."gift_requests"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "gift_request_events" ADD CONSTRAINT "gift_request_events_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "gift_requests" ADD CONSTRAINT "gift_requests_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "gift_requests" ADD CONSTRAINT "gift_requests_requester_id_users_id_fk" FOREIGN KEY ("requester_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "gift_requests" ADD CONSTRAINT "gift_requests_org_unit_id_org_units_id_fk" FOREIGN KEY ("org_unit_id") REFERENCES "public"."org_units"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "gift_requests" ADD CONSTRAINT "gift_requests_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "gift_requests" ADD CONSTRAINT "gift_requests_opportunity_id_opportunities_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."opportunities"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "gift_requests" ADD CONSTRAINT "gift_requests_kit_id_gift_kits_id_fk" FOREIGN KEY ("kit_id") REFERENCES "public"."gift_kits"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "gift_requests" ADD CONSTRAINT "gift_requests_cost_center_id_cost_centers_id_fk" FOREIGN KEY ("cost_center_id") REFERENCES "public"."cost_centers"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "gift_requests" ADD CONSTRAINT "gift_requests_budget_line_id_budget_lines_id_fk" FOREIGN KEY ("budget_line_id") REFERENCES "public"."budget_lines"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "gift_requests" ADD CONSTRAINT "gift_requests_executor_id_users_id_fk" FOREIGN KEY ("executor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "gift_requests" ADD CONSTRAINT "gift_requests_delivery_id_gift_deliveries_id_fk" FOREIGN KEY ("delivery_id") REFERENCES "public"."gift_deliveries"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "gift_compliance_reports_code_uq" ON "gift_compliance_reports" USING btree ("tenant_id","code");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "gift_compliance_rules_uq" ON "gift_compliance_rules" USING btree ("tenant_id","rule_key","version");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "gift_request_accounts_uq" ON "gift_request_accounts" USING btree ("request_id","contact_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "gift_request_accounts_contact_idx" ON "gift_request_accounts" USING btree ("contact_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "gift_request_decisions_idx" ON "gift_request_decisions" USING btree ("request_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "gift_request_documents_idx" ON "gift_request_documents" USING btree ("request_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "gift_request_events_idx" ON "gift_request_events" USING btree ("request_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "gift_requests_code_uq" ON "gift_requests" USING btree ("tenant_id","code");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "gift_requests_delivery_uq" ON "gift_requests" USING btree ("delivery_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "gift_requests_idx" ON "gift_requests" USING btree ("tenant_id","state","planned_on");