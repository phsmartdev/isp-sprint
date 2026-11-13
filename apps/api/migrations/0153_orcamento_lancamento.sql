CREATE TABLE IF NOT EXISTS "budget_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"line_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"mime" text NOT NULL,
	"size" integer NOT NULL,
	"data" "bytea" NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "budget_documents_kind_ck" CHECK (kind in ('anexo','cotacao','pedido','nota_fiscal','entrega','comprovante','outro'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "budget_payables" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"line_id" uuid NOT NULL,
	"cost_center_id" uuid NOT NULL,
	"supplier_id" uuid,
	"invoice_number" text,
	"installment" integer DEFAULT 1 NOT NULL,
	"installments" integer DEFAULT 1 NOT NULL,
	"amount_cents" bigint NOT NULL,
	"competence" text NOT NULL,
	"due_on" date NOT NULL,
	"planned_pay_on" date,
	"external_id" text,
	"status" text DEFAULT 'aberto' NOT NULL,
	"cancel_reason" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "budget_payables_status_ck" CHECK (status in ('aberto','cancelado')),
	CONSTRAINT "budget_payables_amount_ck" CHECK (amount_cents > 0)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "budget_payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"payable_id" uuid NOT NULL,
	"line_id" uuid NOT NULL,
	"kind" text DEFAULT 'pagamento' NOT NULL,
	"reverses_id" uuid,
	"paid_on" date NOT NULL,
	"amount_cents" bigint NOT NULL,
	"interest_cents" bigint DEFAULT 0 NOT NULL,
	"fine_cents" bigint DEFAULT 0 NOT NULL,
	"discount_cents" bigint DEFAULT 0 NOT NULL,
	"method" text,
	"reason" text,
	"idempotency_key" text NOT NULL,
	"proof_id" uuid,
	"reconciled_at" timestamp with time zone,
	"reconciled_by" uuid,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "budget_payments_kind_ck" CHECK (kind in ('pagamento','estorno')),
	CONSTRAINT "budget_payments_amount_ck" CHECK (amount_cents >= 0 and interest_cents >= 0 and fine_cents >= 0 and discount_cents >= 0)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "budget_policies" (
	"tenant_id" uuid PRIMARY KEY NOT NULL,
	"alert_pct" integer,
	"block_pct" integer,
	"reserve_mode" text DEFAULT 'nenhuma' NOT NULL,
	"global_reserve_cents" bigint,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "budget_policies_mode_ck" CHECK (reserve_mode in ('nenhuma','global','centro','hibrida'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "budget_questions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"cost_center_id" uuid NOT NULL,
	"line_id" uuid,
	"kind" text NOT NULL,
	"message" text NOT NULL,
	"blocking" boolean DEFAULT true NOT NULL,
	"asked_by" uuid NOT NULL,
	"to_user_id" uuid,
	"status" text DEFAULT 'aberto' NOT NULL,
	"answer" text,
	"answered_by" uuid,
	"answered_at" timestamp with time zone,
	"resolved_by" uuid,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "budget_questions_status_ck" CHECK (status in ('aberto','respondido','resolvido')),
	CONSTRAINT "budget_questions_kind_ck" CHECK (kind in ('valor_unitario','quantidade','necessidade','documentos','outro'))
);
--> statement-breakpoint
ALTER TABLE "budget_adjustments" ADD COLUMN "line_id" uuid;--> statement-breakpoint
ALTER TABLE "budget_adjustments" ADD COLUMN "from_reserve" text;--> statement-breakpoint
ALTER TABLE "budget_events" ADD COLUMN "data" jsonb;--> statement-breakpoint
ALTER TABLE "budget_lines" ADD COLUMN "code" text;--> statement-breakpoint
ALTER TABLE "budget_lines" ADD COLUMN "owner_id" uuid;--> statement-breakpoint
ALTER TABLE "budget_lines" ADD COLUMN "justification" text;--> statement-breakpoint
ALTER TABLE "budget_lines" ADD COLUMN "objective" text;--> statement-breakpoint
ALTER TABLE "budget_lines" ADD COLUMN "project_id" uuid;--> statement-breakpoint
ALTER TABLE "budget_lines" ADD COLUMN "campaign_id" uuid;--> statement-breakpoint
ALTER TABLE "budget_lines" ADD COLUMN "gift_item_id" uuid;--> statement-breakpoint
ALTER TABLE "budget_lines" ADD COLUMN "qty_milli" bigint DEFAULT 1000 NOT NULL;--> statement-breakpoint
ALTER TABLE "budget_lines" ADD COLUMN "unit" text DEFAULT 'un' NOT NULL;--> statement-breakpoint
ALTER TABLE "budget_lines" ADD COLUMN "unit_cents" bigint;--> statement-breakpoint
ALTER TABLE "budget_lines" ADD COLUMN "priority" text DEFAULT 'media' NOT NULL;--> statement-breakpoint
ALTER TABLE "budget_lines" ADD COLUMN "expense_type" text DEFAULT 'pontual' NOT NULL;--> statement-breakpoint
ALTER TABLE "budget_lines" ADD COLUMN "recurrence_group_id" uuid;--> statement-breakpoint
ALTER TABLE "budget_lines" ADD COLUMN "planned_on" date;--> statement-breakpoint
ALTER TABLE "budget_lines" ADD COLUMN "approval_state" text DEFAULT 'rascunho' NOT NULL;--> statement-breakpoint
ALTER TABLE "budget_lines" ADD COLUMN "first_approved_cents" bigint;--> statement-breakpoint
ALTER TABLE "budget_lines" ADD COLUMN "approved_cents" bigint;--> statement-breakpoint
ALTER TABLE "budget_lines" ADD COLUMN "approved_qty_milli" bigint;--> statement-breakpoint
ALTER TABLE "budget_lines" ADD COLUMN "target_unit_cents" bigint;--> statement-breakpoint
ALTER TABLE "budget_lines" ADD COLUMN "limit_cents" bigint;--> statement-breakpoint
ALTER TABLE "budget_lines" ADD COLUMN "conditions" text;--> statement-breakpoint
ALTER TABLE "budget_lines" ADD COLUMN "execution_state" text DEFAULT 'nao_iniciada' NOT NULL;--> statement-breakpoint
ALTER TABLE "budget_lines" ADD COLUMN "quote_cents" bigint;--> statement-breakpoint
ALTER TABLE "budget_lines" ADD COLUMN "negotiated_cents" bigint;--> statement-breakpoint
ALTER TABLE "budget_lines" ADD COLUMN "contracted_cents" bigint;--> statement-breakpoint
ALTER TABLE "budget_lines" ADD COLUMN "contracted_qty_milli" bigint;--> statement-breakpoint
ALTER TABLE "budget_lines" ADD COLUMN "contracted_on" date;--> statement-breakpoint
ALTER TABLE "budget_lines" ADD COLUMN "po_number" text;--> statement-breakpoint
ALTER TABLE "budget_lines" ADD COLUMN "delivered_qty_milli" bigint;--> statement-breakpoint
ALTER TABLE "budget_lines" ADD COLUMN "delivered_on" date;--> statement-breakpoint
ALTER TABLE "budget_lines" ADD COLUMN "row_version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "cost_centers" ADD COLUMN "manager_id" uuid;--> statement-breakpoint
ALTER TABLE "cost_centers" ADD COLUMN "director_id" uuid;--> statement-breakpoint
ALTER TABLE "cost_centers" ADD COLUMN "alert_pct" integer;--> statement-breakpoint
ALTER TABLE "cost_centers" ADD COLUMN "block_pct" integer;--> statement-breakpoint
ALTER TABLE "cost_centers" ADD COLUMN "guardian_reserve_cents" bigint;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "budget_documents" ADD CONSTRAINT "budget_documents_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "budget_documents" ADD CONSTRAINT "budget_documents_line_id_budget_lines_id_fk" FOREIGN KEY ("line_id") REFERENCES "public"."budget_lines"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "budget_documents" ADD CONSTRAINT "budget_documents_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "budget_payables" ADD CONSTRAINT "budget_payables_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "budget_payables" ADD CONSTRAINT "budget_payables_line_id_budget_lines_id_fk" FOREIGN KEY ("line_id") REFERENCES "public"."budget_lines"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "budget_payables" ADD CONSTRAINT "budget_payables_cost_center_id_cost_centers_id_fk" FOREIGN KEY ("cost_center_id") REFERENCES "public"."cost_centers"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "budget_payables" ADD CONSTRAINT "budget_payables_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "budget_payables" ADD CONSTRAINT "budget_payables_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "budget_payments" ADD CONSTRAINT "budget_payments_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "budget_payments" ADD CONSTRAINT "budget_payments_payable_id_budget_payables_id_fk" FOREIGN KEY ("payable_id") REFERENCES "public"."budget_payables"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "budget_payments" ADD CONSTRAINT "budget_payments_line_id_budget_lines_id_fk" FOREIGN KEY ("line_id") REFERENCES "public"."budget_lines"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "budget_payments" ADD CONSTRAINT "budget_payments_reconciled_by_users_id_fk" FOREIGN KEY ("reconciled_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "budget_payments" ADD CONSTRAINT "budget_payments_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "budget_policies" ADD CONSTRAINT "budget_policies_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "budget_policies" ADD CONSTRAINT "budget_policies_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "budget_questions" ADD CONSTRAINT "budget_questions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "budget_questions" ADD CONSTRAINT "budget_questions_cost_center_id_cost_centers_id_fk" FOREIGN KEY ("cost_center_id") REFERENCES "public"."cost_centers"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "budget_questions" ADD CONSTRAINT "budget_questions_line_id_budget_lines_id_fk" FOREIGN KEY ("line_id") REFERENCES "public"."budget_lines"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "budget_questions" ADD CONSTRAINT "budget_questions_asked_by_users_id_fk" FOREIGN KEY ("asked_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "budget_questions" ADD CONSTRAINT "budget_questions_to_user_id_users_id_fk" FOREIGN KEY ("to_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "budget_questions" ADD CONSTRAINT "budget_questions_answered_by_users_id_fk" FOREIGN KEY ("answered_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "budget_questions" ADD CONSTRAINT "budget_questions_resolved_by_users_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "budget_documents_idx" ON "budget_documents" USING btree ("tenant_id","line_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "budget_payables_idx" ON "budget_payables" USING btree ("tenant_id","line_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "budget_payables_ext_uq" ON "budget_payables" USING btree ("tenant_id","external_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "budget_payments_idx" ON "budget_payments" USING btree ("tenant_id","line_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "budget_payments_idem_uq" ON "budget_payments" USING btree ("tenant_id","idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "budget_payments_rev_uq" ON "budget_payments" USING btree ("reverses_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "budget_questions_idx" ON "budget_questions" USING btree ("tenant_id","line_id");--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "budget_lines" ADD CONSTRAINT "budget_lines_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "cost_centers" ADD CONSTRAINT "cost_centers_manager_id_users_id_fk" FOREIGN KEY ("manager_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "cost_centers" ADD CONSTRAINT "cost_centers_director_id_users_id_fk" FOREIGN KEY ("director_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "budget_events_ent_idx" ON "budget_events" USING btree ("entity","entity_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "budget_lines_code_uq" ON "budget_lines" USING btree ("tenant_id","code");--> statement-breakpoint
ALTER TABLE "budget_lines" ADD CONSTRAINT "budget_lines_approval_ck" CHECK (approval_state in ('rascunho','planejado','enviado','em_analise','questionado','em_revisao','aprovado','aprovado_ressalvas','rejeitado'));--> statement-breakpoint
ALTER TABLE "budget_lines" ADD CONSTRAINT "budget_lines_exec_ck" CHECK (execution_state in ('nao_iniciada','comprometido','em_execucao','executado_parcial','executado','encerrado'));--> statement-breakpoint
ALTER TABLE "budget_lines" ADD CONSTRAINT "budget_lines_qty_ck" CHECK (qty_milli > 0);--> statement-breakpoint
ALTER TABLE "budget_lines" ADD CONSTRAINT "budget_lines_limit_ck" CHECK (limit_cents is null or approved_cents is null or limit_cents <= approved_cents);--> statement-breakpoint
-- lançamentos existentes: preserva tudo e preenche o ciclo de vida a partir do que já se sabia
UPDATE "budget_lines" SET
  "approval_state" = CASE "status" WHEN 'aprovado' THEN 'aprovado' WHEN 'recusado' THEN 'rejeitado' WHEN 'em_aprovacao' THEN 'enviado' ELSE 'rascunho' END,
  "approved_cents" = CASE WHEN "status" = 'aprovado' THEN "amount_cents" END,
  "first_approved_cents" = CASE WHEN "status" = 'aprovado' THEN "amount_cents" END,
  "approved_qty_milli" = CASE WHEN "status" = 'aprovado' THEN 1000 END,
  "unit_cents" = "amount_cents",
  "owner_id" = "created_by",
  "expense_type" = CASE WHEN "resource_id" IS NOT NULL THEN 'recorrente' ELSE 'pontual' END;--> statement-breakpoint
UPDATE "budget_lines" b SET "code" = x.code FROM (
  SELECT id, 'ORC-' || substr(month, 1, 4) || '-' || lpad(row_number() OVER (PARTITION BY tenant_id ORDER BY created_at, id)::text, 4, '0') AS code FROM "budget_lines"
) x WHERE x.id = b.id;--> statement-breakpoint
UPDATE "cost_centers" c SET "manager_id" = c."leader_id" WHERE c."manager_id" IS NULL AND c."leader_id" IS NOT NULL;
