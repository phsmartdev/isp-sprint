CREATE TABLE IF NOT EXISTS "business_event_credits" (
	"event_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"share_bp" integer NOT NULL,
	CONSTRAINT "business_event_credits_event_id_user_id_kind_pk" PRIMARY KEY("event_id","user_id","kind"),
	CONSTRAINT "business_event_credits_kind_ck" CHECK (kind in ('direto','participacao','gestao'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "business_event_reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"from_validation" text NOT NULL,
	"to_validation" text NOT NULL,
	"reason" text NOT NULL,
	"actor_id" uuid,
	"automatic" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "business_event_sync" (
	"tenant_id" uuid PRIMARY KEY NOT NULL,
	"last_run_at" timestamp with time zone NOT NULL,
	"stats" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "business_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"type" text NOT NULL,
	"module" text NOT NULL,
	"source_type" text NOT NULL,
	"source_id" uuid NOT NULL,
	"owner_id" uuid,
	"participants" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"team_id" uuid,
	"occurred_at" timestamp with time zone NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"outcome" text,
	"value_cents" bigint,
	"quantity" integer,
	"validation" text DEFAULT 'valido' NOT NULL,
	"validated_at" timestamp with time zone,
	"validated_by" uuid,
	"context" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"idem_key" text NOT NULL,
	"rule_version" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "business_events_validation_ck" CHECK (validation in ('valido','pendente','invalidado'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "performance_settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"config" jsonb NOT NULL,
	"note" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "access_policies" DROP CONSTRAINT "access_module_ck";--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "business_event_credits" ADD CONSTRAINT "business_event_credits_event_id_business_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."business_events"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "business_event_credits" ADD CONSTRAINT "business_event_credits_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "business_event_credits" ADD CONSTRAINT "business_event_credits_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "business_event_reviews" ADD CONSTRAINT "business_event_reviews_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "business_event_reviews" ADD CONSTRAINT "business_event_reviews_event_id_business_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."business_events"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "business_event_reviews" ADD CONSTRAINT "business_event_reviews_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "business_event_sync" ADD CONSTRAINT "business_event_sync_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "business_events" ADD CONSTRAINT "business_events_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "business_events" ADD CONSTRAINT "business_events_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "performance_settings" ADD CONSTRAINT "performance_settings_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "performance_settings" ADD CONSTRAINT "performance_settings_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "business_event_credits_user_idx" ON "business_event_credits" USING btree ("tenant_id","user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "business_event_reviews_idx" ON "business_event_reviews" USING btree ("tenant_id","event_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "business_events_idem_uq" ON "business_events" USING btree ("tenant_id","idem_key");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "business_events_type_idx" ON "business_events" USING btree ("tenant_id","type","occurred_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "business_events_owner_idx" ON "business_events" USING btree ("tenant_id","owner_id","occurred_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "business_events_source_idx" ON "business_events" USING btree ("tenant_id","source_type","source_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "performance_settings_uq" ON "performance_settings" USING btree ("tenant_id","version");--> statement-breakpoint
ALTER TABLE "access_policies" ADD CONSTRAINT "access_module_ck" CHECK (module in ('inicio','leads','oportunidades','clientes','atividades','relatorios','campanhas','contratos','projetos','desempenho','inteligencia','configuracoes'));--> statement-breakpoint
CREATE OR REPLACE FUNCTION isp_forbid_mutation() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE'
     AND TG_TABLE_NAME IN ('opportunity_events', 'activity_events', 'email_messages', 'contract_events', 'contract_versions', 'contract_ledger',
                           'contact_classifications', 'contact_identity_links', 'approval_requests', 'approval_decisions', 'negotiation_messages',
                           'arp_rule_sets', 'arp_item_changes', 'arp_ledger', 'arp_documents', 'arp_events',
                           'cs_assessments', 'cs_presentations', 'cs_surveys', 'project_events',
                           'activity_comments', 'activity_time_entries',
                           'business_events', 'business_event_credits', 'business_event_reviews', 'performance_settings')
     AND current_setting('isp.allow_purge', true) = 'on' THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'Tabela % é append-only (operação % bloqueada)', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'check_violation';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
-- evento de negócio: só a validação pode mudar; o fato em si é imutável
CREATE OR REPLACE FUNCTION isp_business_event_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF current_setting('isp.allow_purge', true) = 'on' THEN RETURN OLD; END IF;
    RAISE EXCEPTION 'Evento de negócio não pode ser apagado' USING ERRCODE = 'check_violation';
  END IF;
  IF (NEW.type, NEW.module, NEW.source_type, NEW.source_id, NEW.owner_id, NEW.participants, NEW.team_id, NEW.occurred_at, NEW.recorded_at, NEW.outcome, NEW.value_cents, NEW.quantity, NEW.context, NEW.idem_key, NEW.rule_version, NEW.tenant_id)
     IS DISTINCT FROM (OLD.type, OLD.module, OLD.source_type, OLD.source_id, OLD.owner_id, OLD.participants, OLD.team_id, OLD.occurred_at, OLD.recorded_at, OLD.outcome, OLD.value_cents, OLD.quantity, OLD.context, OLD.idem_key, OLD.rule_version, OLD.tenant_id) THEN
    RAISE EXCEPTION 'Evento de negócio é imutável; só a validação pode mudar' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER business_events_guard BEFORE UPDATE OR DELETE ON "business_events" FOR EACH ROW EXECUTE FUNCTION isp_business_event_guard();
--> statement-breakpoint
CREATE TRIGGER business_event_credits_append_only BEFORE UPDATE OR DELETE ON "business_event_credits" FOR EACH ROW EXECUTE FUNCTION isp_forbid_mutation();
--> statement-breakpoint
CREATE TRIGGER business_event_reviews_append_only BEFORE UPDATE OR DELETE ON "business_event_reviews" FOR EACH ROW EXECUTE FUNCTION isp_forbid_mutation();
--> statement-breakpoint
CREATE TRIGGER performance_settings_append_only BEFORE UPDATE OR DELETE ON "performance_settings" FOR EACH ROW EXECUTE FUNCTION isp_forbid_mutation();
--> statement-breakpoint
INSERT INTO "access_policies" ("role_id", "module", "level")
SELECT r.id, 'desempenho', CASE r.key WHEN 'gerencia' THEN 'total' WHEN 'supervisor' THEN 'equipe' WHEN 'vendedor' THEN 'proprio' ELSE 'nenhum' END
FROM "roles" r ON CONFLICT DO NOTHING;
