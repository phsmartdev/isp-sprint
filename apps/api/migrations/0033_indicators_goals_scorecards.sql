CREATE TABLE IF NOT EXISTS "goal_checkins" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"goal_id" uuid NOT NULL,
	"value" double precision NOT NULL,
	"note" text,
	"actor_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "goal_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"goal_id" uuid NOT NULL,
	"type" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"actor_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "goal_results" (
	"goal_id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"value" double precision,
	"target" double precision NOT NULL,
	"attainment" double precision,
	"status" text NOT NULL,
	"indicator_version" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "goals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"title" text NOT NULL,
	"scope" text NOT NULL,
	"category" text DEFAULT 'comercial' NOT NULL,
	"indicator_id" uuid,
	"manual_unit" text,
	"user_id" uuid,
	"team_id" uuid,
	"owner_id" uuid NOT NULL,
	"period_type" text NOT NULL,
	"period_start" date NOT NULL,
	"period_end" date NOT NULL,
	"target" double precision NOT NULL,
	"objective_id" uuid,
	"parent_goal_id" uuid,
	"weight" integer DEFAULT 1 NOT NULL,
	"consolidation" text DEFAULT 'indicador' NOT NULL,
	"original_target" double precision NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"notes" text,
	"status" text DEFAULT 'ativa' NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"row_version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "goals_scope_ck" CHECK (scope in ('individual','equipe','empresa')),
	CONSTRAINT "goals_status_ck" CHECK (status in ('ativa','cancelada')),
	CONSTRAINT "goals_period_ck" CHECK (period_type in ('semana','mes','trimestre','ano','personalizado')),
	CONSTRAINT "goals_consolidation_ck" CHECK (consolidation in ('indicador','soma','media_ponderada','media_simples','nao_agregavel'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "indicator_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"indicator_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"def" jsonb NOT NULL,
	"note" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "indicators" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"key" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"current_version" integer DEFAULT 1 NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "objectives" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"level" text DEFAULT 'estrategico' NOT NULL,
	"parent_id" uuid,
	"area" text,
	"team_id" uuid,
	"owner_id" uuid NOT NULL,
	"sponsor_id" uuid,
	"priority" text DEFAULT 'media' NOT NULL,
	"period_start" date NOT NULL,
	"period_end" date NOT NULL,
	"status" text DEFAULT 'ativo' NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"row_version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "objectives_level_ck" CHECK (level in ('estrategico','tatico','operacional')),
	CONSTRAINT "objectives_status_ck" CHECK (status in ('ativo','encerrado','cancelado')),
	CONSTRAINT "objectives_priority_ck" CHECK (priority in ('baixa','media','alta'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "scorecard_assignments" (
	"user_id" uuid NOT NULL,
	"scorecard_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"weight" integer DEFAULT 100 NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "scorecard_assignments_user_id_scorecard_id_pk" PRIMARY KEY("user_id","scorecard_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "scorecard_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"scorecard_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"def" jsonb NOT NULL,
	"note" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "scorecards" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"applies_profiles" text[] DEFAULT '{}'::text[] NOT NULL,
	"applies_job_titles" text[] DEFAULT '{}'::text[] NOT NULL,
	"applies_team_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"periodicity" text DEFAULT 'mes' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"current_version" integer DEFAULT 1 NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "goal_checkins" ADD CONSTRAINT "goal_checkins_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "goal_checkins" ADD CONSTRAINT "goal_checkins_goal_id_goals_id_fk" FOREIGN KEY ("goal_id") REFERENCES "public"."goals"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "goal_checkins" ADD CONSTRAINT "goal_checkins_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "goal_events" ADD CONSTRAINT "goal_events_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "goal_events" ADD CONSTRAINT "goal_events_goal_id_goals_id_fk" FOREIGN KEY ("goal_id") REFERENCES "public"."goals"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "goal_events" ADD CONSTRAINT "goal_events_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "goal_results" ADD CONSTRAINT "goal_results_goal_id_goals_id_fk" FOREIGN KEY ("goal_id") REFERENCES "public"."goals"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "goal_results" ADD CONSTRAINT "goal_results_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "goals" ADD CONSTRAINT "goals_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "goals" ADD CONSTRAINT "goals_indicator_id_indicators_id_fk" FOREIGN KEY ("indicator_id") REFERENCES "public"."indicators"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "goals" ADD CONSTRAINT "goals_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "goals" ADD CONSTRAINT "goals_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "goals" ADD CONSTRAINT "goals_objective_id_objectives_id_fk" FOREIGN KEY ("objective_id") REFERENCES "public"."objectives"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "goals" ADD CONSTRAINT "goals_parent_goal_id_goals_id_fk" FOREIGN KEY ("parent_goal_id") REFERENCES "public"."goals"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "goals" ADD CONSTRAINT "goals_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "indicator_versions" ADD CONSTRAINT "indicator_versions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "indicator_versions" ADD CONSTRAINT "indicator_versions_indicator_id_indicators_id_fk" FOREIGN KEY ("indicator_id") REFERENCES "public"."indicators"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "indicator_versions" ADD CONSTRAINT "indicator_versions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "indicators" ADD CONSTRAINT "indicators_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "indicators" ADD CONSTRAINT "indicators_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "objectives" ADD CONSTRAINT "objectives_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "objectives" ADD CONSTRAINT "objectives_parent_id_objectives_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."objectives"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "objectives" ADD CONSTRAINT "objectives_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "objectives" ADD CONSTRAINT "objectives_sponsor_id_users_id_fk" FOREIGN KEY ("sponsor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "objectives" ADD CONSTRAINT "objectives_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "scorecard_assignments" ADD CONSTRAINT "scorecard_assignments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "scorecard_assignments" ADD CONSTRAINT "scorecard_assignments_scorecard_id_scorecards_id_fk" FOREIGN KEY ("scorecard_id") REFERENCES "public"."scorecards"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "scorecard_assignments" ADD CONSTRAINT "scorecard_assignments_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "scorecard_assignments" ADD CONSTRAINT "scorecard_assignments_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "scorecard_versions" ADD CONSTRAINT "scorecard_versions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "scorecard_versions" ADD CONSTRAINT "scorecard_versions_scorecard_id_scorecards_id_fk" FOREIGN KEY ("scorecard_id") REFERENCES "public"."scorecards"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "scorecard_versions" ADD CONSTRAINT "scorecard_versions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "scorecards" ADD CONSTRAINT "scorecards_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "scorecards" ADD CONSTRAINT "scorecards_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "goal_checkins_idx" ON "goal_checkins" USING btree ("tenant_id","goal_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "goal_events_idx" ON "goal_events" USING btree ("tenant_id","goal_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "goals_parent_idx" ON "goals" USING btree ("tenant_id","parent_goal_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "goals_idx" ON "goals" USING btree ("tenant_id","period_end","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "indicator_versions_uq" ON "indicator_versions" USING btree ("indicator_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "indicators_key_uq" ON "indicators" USING btree ("tenant_id","key");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "objectives_idx" ON "objectives" USING btree ("tenant_id","period_end");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "scorecard_versions_uq" ON "scorecard_versions" USING btree ("scorecard_id","version");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "scorecards_idx" ON "scorecards" USING btree ("tenant_id","active");--> statement-breakpoint
CREATE OR REPLACE FUNCTION isp_forbid_mutation() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE'
     AND TG_TABLE_NAME IN ('opportunity_events', 'activity_events', 'email_messages', 'contract_events', 'contract_versions', 'contract_ledger',
                           'contact_classifications', 'contact_identity_links', 'approval_requests', 'approval_decisions', 'negotiation_messages',
                           'arp_rule_sets', 'arp_item_changes', 'arp_ledger', 'arp_documents', 'arp_events',
                           'cs_assessments', 'cs_presentations', 'cs_surveys', 'project_events',
                           'activity_comments', 'activity_time_entries',
                           'business_events', 'business_event_credits', 'business_event_reviews', 'performance_settings',
                           'indicator_versions', 'scorecard_versions', 'goal_events', 'goal_checkins', 'goal_results')
     AND current_setting('isp.allow_purge', true) = 'on' THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'Tabela % é append-only (operação % bloqueada)', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'check_violation';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER indicator_versions_append_only BEFORE UPDATE OR DELETE ON "indicator_versions" FOR EACH ROW EXECUTE FUNCTION isp_forbid_mutation();
--> statement-breakpoint
CREATE TRIGGER scorecard_versions_append_only BEFORE UPDATE OR DELETE ON "scorecard_versions" FOR EACH ROW EXECUTE FUNCTION isp_forbid_mutation();
--> statement-breakpoint
CREATE TRIGGER goal_events_append_only BEFORE UPDATE OR DELETE ON "goal_events" FOR EACH ROW EXECUTE FUNCTION isp_forbid_mutation();
--> statement-breakpoint
CREATE TRIGGER goal_checkins_append_only BEFORE UPDATE OR DELETE ON "goal_checkins" FOR EACH ROW EXECUTE FUNCTION isp_forbid_mutation();
--> statement-breakpoint
CREATE TRIGGER goal_results_append_only BEFORE UPDATE OR DELETE ON "goal_results" FOR EACH ROW EXECUTE FUNCTION isp_forbid_mutation();
