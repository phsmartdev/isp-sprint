CREATE TABLE IF NOT EXISTS "financial_formula_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"version_id" uuid NOT NULL,
	"code" text NOT NULL,
	"action" text NOT NULL,
	"note" text,
	"actor_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "financial_formula_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"code" text NOT NULL,
	"version" integer NOT NULL,
	"expression" text NOT NULL,
	"status" text DEFAULT 'rascunho' NOT NULL,
	"justification" text,
	"refs" text[] DEFAULT '{}'::text[] NOT NULL,
	"base_version_id" uuid,
	"restored_from_id" uuid,
	"simulation" jsonb,
	"valid_from" date,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"submitted_by" uuid,
	"submitted_at" timestamp with time zone,
	"validated_by" uuid,
	"validated_at" timestamp with time zone,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"published_by" uuid,
	"published_at" timestamp with time zone,
	CONSTRAINT "financial_formula_versions_status_ck" CHECK (status in ('rascunho','simulada','em_validacao','validada','aprovada','publicada','devolvida'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "financial_formulas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"category" text DEFAULT 'personalizadas' NOT NULL,
	"unit" text NOT NULL,
	"description" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "financial_formula_events" ADD CONSTRAINT "financial_formula_events_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "financial_formula_events" ADD CONSTRAINT "financial_formula_events_version_id_financial_formula_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."financial_formula_versions"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "financial_formula_versions" ADD CONSTRAINT "financial_formula_versions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "financial_formulas" ADD CONSTRAINT "financial_formulas_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "financial_formula_events_idx" ON "financial_formula_events" USING btree ("tenant_id","code","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "financial_formula_versions_uq" ON "financial_formula_versions" USING btree ("tenant_id","code","version");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "financial_formula_versions_idx" ON "financial_formula_versions" USING btree ("tenant_id","code","status");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "financial_formulas_uq" ON "financial_formulas" USING btree ("tenant_id","code");--> statement-breakpoint
-- Governança das fórmulas: histórico nunca muda; versão só muda enquanto é rascunho, simulada ou devolvida; nada é apagado.
CREATE OR REPLACE FUNCTION isp_fin_formula_version_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF current_setting('isp.allow_purge', true) = 'on' THEN RETURN OLD; END IF;
    RAISE EXCEPTION 'Versão de fórmula não pode ser apagada' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.status = 'publicada' THEN RAISE EXCEPTION 'Fórmula publicada não pode ser alterada: crie uma nova versão' USING ERRCODE = 'check_violation'; END IF;
  IF OLD.status NOT IN ('rascunho', 'simulada', 'devolvida') AND (NEW.expression IS DISTINCT FROM OLD.expression) THEN
    RAISE EXCEPTION 'Expressão travada depois do envio para validação' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER financial_formula_versions_guard BEFORE UPDATE OR DELETE ON "financial_formula_versions" FOR EACH ROW EXECUTE FUNCTION isp_fin_formula_version_guard();
--> statement-breakpoint
CREATE TRIGGER financial_formula_events_append_only BEFORE UPDATE OR DELETE ON "financial_formula_events" FOR EACH ROW EXECUTE FUNCTION isp_econ_snapshot_guard();
