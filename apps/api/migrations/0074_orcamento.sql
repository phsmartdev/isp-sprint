CREATE TABLE IF NOT EXISTS "budget_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"parent_id" uuid,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"nature" text DEFAULT 'despesa' NOT NULL,
	"description" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "budget_accounts_nature_ck" CHECK (nature in ('despesa','receita'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "budget_adjustments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"cost_center_id" uuid NOT NULL,
	"year" integer NOT NULL,
	"quarter" integer NOT NULL,
	"account_id" uuid NOT NULL,
	"month" text NOT NULL,
	"delta_cents" bigint NOT NULL,
	"justification" text NOT NULL,
	"pct" double precision,
	"status" text NOT NULL,
	"requested_by" uuid,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"decision_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "budget_adjustments_status_ck" CHECK (status in ('registrado','pendente','aprovado','recusado'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "budget_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"cost_center_id" uuid,
	"entity" text NOT NULL,
	"entity_id" uuid,
	"action" text NOT NULL,
	"summary" text NOT NULL,
	"actor_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "budget_expenses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"cost_center_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"line_id" uuid,
	"occurred_on" date NOT NULL,
	"description" text NOT NULL,
	"amount_cents" bigint NOT NULL,
	"supplier_id" uuid,
	"payment_method" text,
	"finance_check" boolean DEFAULT false NOT NULL,
	"doc_name" text,
	"doc_mime" text,
	"doc_size" integer,
	"doc_data" "bytea",
	"resource_id" uuid,
	"asset_id" uuid,
	"purchase_id" uuid,
	"status" text DEFAULT 'valido' NOT NULL,
	"cancel_reason" text,
	"cancelled_at" timestamp with time zone,
	"cancelled_by" uuid,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "budget_expenses_status_ck" CHECK (status in ('valido','cancelado')),
	CONSTRAINT "budget_expenses_amount_ck" CHECK (amount_cents > 0)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "budget_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"plan_id" uuid NOT NULL,
	"cost_center_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"what" text NOT NULL,
	"how" text,
	"month" text NOT NULL,
	"amount_cents" bigint NOT NULL,
	"item_type" text DEFAULT 'outro' NOT NULL,
	"supplier_id" uuid,
	"resource_id" uuid,
	"status" text DEFAULT 'rascunho' NOT NULL,
	"decision_note" text,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "budget_lines_status_ck" CHECK (status in ('rascunho','em_aprovacao','aprovado','recusado')),
	CONSTRAINT "budget_lines_amount_ck" CHECK (amount_cents > 0)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "budget_plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"cost_center_id" uuid NOT NULL,
	"year" integer NOT NULL,
	"quarter" integer NOT NULL,
	"status" text DEFAULT 'rascunho' NOT NULL,
	"note" text,
	"submitted_at" timestamp with time zone,
	"submitted_by" uuid,
	"decided_at" timestamp with time zone,
	"decided_by" uuid,
	"row_version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "budget_plans_status_ck" CHECK (status in ('rascunho','em_aprovacao','aprovado','devolvido')),
	CONSTRAINT "budget_plans_q_ck" CHECK (quarter between 1 and 4)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "budget_reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"cost_center_id" uuid NOT NULL,
	"month" text NOT NULL,
	"account_id" uuid NOT NULL,
	"planned_cents" bigint NOT NULL,
	"realized_cents" bigint NOT NULL,
	"justification" text NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "cost_centers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"leader_id" uuid,
	"member_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "purchase_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"cost_center_id" uuid NOT NULL,
	"account_id" uuid,
	"line_id" uuid,
	"title" text NOT NULL,
	"specification" text NOT NULL,
	"kind" text DEFAULT 'consumo' NOT NULL,
	"estimated_cents" bigint NOT NULL,
	"needed_by" date,
	"quotes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"supplier_id" uuid,
	"status" text DEFAULT 'solicitado' NOT NULL,
	"finance_check" boolean DEFAULT false NOT NULL,
	"legal_review" boolean DEFAULT false NOT NULL,
	"director_signed" boolean DEFAULT false NOT NULL,
	"director_release" text,
	"expense_id" uuid,
	"requested_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "purchase_requests_kind_ck" CHECK (kind in ('consumo','especifica')),
	CONSTRAINT "purchase_requests_status_ck" CHECK (status in ('solicitado','em_cotacao','aprovado','comprado','recebido','cancelado'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "resource_assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"cost_center_id" uuid NOT NULL,
	"account_id" uuid,
	"name" text NOT NULL,
	"tag" text,
	"serial" text,
	"category" text DEFAULT 'outro' NOT NULL,
	"holder_id" uuid,
	"supplier_id" uuid,
	"acquired_on" date NOT NULL,
	"value_cents" bigint NOT NULL,
	"useful_life_months" integer,
	"status" text DEFAULT 'em_uso' NOT NULL,
	"notes" text,
	"expense_id" uuid,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "resource_assets_status_ck" CHECK (status in ('em_uso','estoque','manutencao','baixado'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "resource_contracts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"cost_center_id" uuid NOT NULL,
	"account_id" uuid,
	"supplier_id" uuid,
	"name" text NOT NULL,
	"object" text,
	"seats" integer,
	"currency" text DEFAULT 'BRL' NOT NULL,
	"amount_cents" bigint NOT NULL,
	"fx_rate" double precision,
	"period" text DEFAULT 'mensal' NOT NULL,
	"start_on" date NOT NULL,
	"end_on" date,
	"renewal_on" date,
	"payment_day" integer,
	"payment_method" text,
	"vault_registered" boolean DEFAULT false NOT NULL,
	"vault_ref" text,
	"owner_id" uuid,
	"legal_reviewed" boolean DEFAULT false NOT NULL,
	"director_signed" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'ativo' NOT NULL,
	"review_on" date,
	"notes" text,
	"cancel_reason" text,
	"cancelled_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "resource_contracts_kind_ck" CHECK (kind in ('software','contrato','assinatura')),
	CONSTRAINT "resource_contracts_status_ck" CHECK (status in ('ativo','suspenso','cancelado')),
	CONSTRAINT "resource_contracts_currency_ck" CHECK (currency in ('BRL','USD')),
	CONSTRAINT "resource_contracts_period_ck" CHECK (period in ('mensal','trimestral','anual','unico'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "suppliers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"document" text,
	"category" text,
	"email" text,
	"phone" text,
	"notes" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "access_policies" DROP CONSTRAINT "access_module_ck";--> statement-breakpoint
ALTER TABLE "tenant_modules" DROP CONSTRAINT "tenant_modules_module_ck";--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "budget_accounts" ADD CONSTRAINT "budget_accounts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "budget_accounts" ADD CONSTRAINT "budget_accounts_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "budget_adjustments" ADD CONSTRAINT "budget_adjustments_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "budget_adjustments" ADD CONSTRAINT "budget_adjustments_cost_center_id_cost_centers_id_fk" FOREIGN KEY ("cost_center_id") REFERENCES "public"."cost_centers"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "budget_adjustments" ADD CONSTRAINT "budget_adjustments_account_id_budget_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."budget_accounts"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "budget_adjustments" ADD CONSTRAINT "budget_adjustments_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "budget_adjustments" ADD CONSTRAINT "budget_adjustments_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "budget_events" ADD CONSTRAINT "budget_events_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "budget_events" ADD CONSTRAINT "budget_events_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "budget_expenses" ADD CONSTRAINT "budget_expenses_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "budget_expenses" ADD CONSTRAINT "budget_expenses_cost_center_id_cost_centers_id_fk" FOREIGN KEY ("cost_center_id") REFERENCES "public"."cost_centers"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "budget_expenses" ADD CONSTRAINT "budget_expenses_account_id_budget_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."budget_accounts"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "budget_expenses" ADD CONSTRAINT "budget_expenses_line_id_budget_lines_id_fk" FOREIGN KEY ("line_id") REFERENCES "public"."budget_lines"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "budget_expenses" ADD CONSTRAINT "budget_expenses_cancelled_by_users_id_fk" FOREIGN KEY ("cancelled_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "budget_expenses" ADD CONSTRAINT "budget_expenses_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "budget_lines" ADD CONSTRAINT "budget_lines_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "budget_lines" ADD CONSTRAINT "budget_lines_plan_id_budget_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."budget_plans"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "budget_lines" ADD CONSTRAINT "budget_lines_cost_center_id_cost_centers_id_fk" FOREIGN KEY ("cost_center_id") REFERENCES "public"."cost_centers"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "budget_lines" ADD CONSTRAINT "budget_lines_account_id_budget_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."budget_accounts"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "budget_lines" ADD CONSTRAINT "budget_lines_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "budget_lines" ADD CONSTRAINT "budget_lines_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "budget_plans" ADD CONSTRAINT "budget_plans_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "budget_plans" ADD CONSTRAINT "budget_plans_cost_center_id_cost_centers_id_fk" FOREIGN KEY ("cost_center_id") REFERENCES "public"."cost_centers"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "budget_plans" ADD CONSTRAINT "budget_plans_submitted_by_users_id_fk" FOREIGN KEY ("submitted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "budget_plans" ADD CONSTRAINT "budget_plans_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "budget_reviews" ADD CONSTRAINT "budget_reviews_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "budget_reviews" ADD CONSTRAINT "budget_reviews_cost_center_id_cost_centers_id_fk" FOREIGN KEY ("cost_center_id") REFERENCES "public"."cost_centers"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "budget_reviews" ADD CONSTRAINT "budget_reviews_account_id_budget_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."budget_accounts"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "budget_reviews" ADD CONSTRAINT "budget_reviews_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "cost_centers" ADD CONSTRAINT "cost_centers_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "cost_centers" ADD CONSTRAINT "cost_centers_leader_id_users_id_fk" FOREIGN KEY ("leader_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "purchase_requests" ADD CONSTRAINT "purchase_requests_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "purchase_requests" ADD CONSTRAINT "purchase_requests_cost_center_id_cost_centers_id_fk" FOREIGN KEY ("cost_center_id") REFERENCES "public"."cost_centers"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "purchase_requests" ADD CONSTRAINT "purchase_requests_account_id_budget_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."budget_accounts"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "purchase_requests" ADD CONSTRAINT "purchase_requests_line_id_budget_lines_id_fk" FOREIGN KEY ("line_id") REFERENCES "public"."budget_lines"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "purchase_requests" ADD CONSTRAINT "purchase_requests_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "resource_assets" ADD CONSTRAINT "resource_assets_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "resource_assets" ADD CONSTRAINT "resource_assets_cost_center_id_cost_centers_id_fk" FOREIGN KEY ("cost_center_id") REFERENCES "public"."cost_centers"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "resource_assets" ADD CONSTRAINT "resource_assets_account_id_budget_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."budget_accounts"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "resource_assets" ADD CONSTRAINT "resource_assets_holder_id_users_id_fk" FOREIGN KEY ("holder_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "resource_assets" ADD CONSTRAINT "resource_assets_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "resource_contracts" ADD CONSTRAINT "resource_contracts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "resource_contracts" ADD CONSTRAINT "resource_contracts_cost_center_id_cost_centers_id_fk" FOREIGN KEY ("cost_center_id") REFERENCES "public"."cost_centers"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "resource_contracts" ADD CONSTRAINT "resource_contracts_account_id_budget_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."budget_accounts"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "resource_contracts" ADD CONSTRAINT "resource_contracts_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "resource_contracts" ADD CONSTRAINT "resource_contracts_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "budget_accounts_uq" ON "budget_accounts" USING btree ("tenant_id","code");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "budget_adjustments_idx" ON "budget_adjustments" USING btree ("tenant_id","cost_center_id","year","quarter");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "budget_events_idx" ON "budget_events" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "budget_expenses_idx" ON "budget_expenses" USING btree ("tenant_id","cost_center_id","occurred_on");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "budget_lines_idx" ON "budget_lines" USING btree ("tenant_id","cost_center_id","month");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "budget_plans_uq" ON "budget_plans" USING btree ("cost_center_id","year","quarter");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "budget_reviews_idx" ON "budget_reviews" USING btree ("tenant_id","cost_center_id","month");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "cost_centers_uq" ON "cost_centers" USING btree ("tenant_id","code");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "purchase_requests_idx" ON "purchase_requests" USING btree ("tenant_id","cost_center_id","status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "resource_assets_idx" ON "resource_assets" USING btree ("tenant_id","cost_center_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "resource_contracts_idx" ON "resource_contracts" USING btree ("tenant_id","kind","cost_center_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "suppliers_idx" ON "suppliers" USING btree ("tenant_id","name");--> statement-breakpoint
ALTER TABLE "access_policies" ADD CONSTRAINT "access_module_ck" CHECK (module in ('inicio','leads','oportunidades','clientes','atividades','relatorios','campanhas','contratos','projetos','desempenho','resultados','inteligencia','email','orcamento','configuracoes'));--> statement-breakpoint
ALTER TABLE "tenant_modules" ADD CONSTRAINT "tenant_modules_module_ck" CHECK (module in ('crm','marketing','produto','gestao_time','contratos','projetos','relatorios','orcamento'));--> statement-breakpoint
INSERT INTO "access_policies" ("role_id", "module", "level")
SELECT r.id, 'orcamento', CASE r.key WHEN 'gerencia' THEN 'total' WHEN 'supervisor' THEN 'proprio' ELSE 'nenhum' END
FROM "roles" r ON CONFLICT DO NOTHING;
--> statement-breakpoint
CREATE TRIGGER budget_reviews_append_only BEFORE UPDATE OR DELETE ON "budget_reviews" FOR EACH ROW EXECUTE FUNCTION isp_forbid_mutation();
--> statement-breakpoint
CREATE TRIGGER budget_events_append_only BEFORE UPDATE OR DELETE ON "budget_events" FOR EACH ROW EXECUTE FUNCTION isp_forbid_mutation();
