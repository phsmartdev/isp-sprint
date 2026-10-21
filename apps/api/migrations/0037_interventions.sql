CREATE TABLE IF NOT EXISTS "intervention_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"intervention_id" uuid NOT NULL,
	"type" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"notify" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"actor_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "intervention_reads" (
	"user_id" uuid NOT NULL,
	"intervention_id" uuid NOT NULL,
	"last_read_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "intervention_reads_user_id_intervention_id_pk" PRIMARY KEY("user_id","intervention_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "interventions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"series_id" uuid NOT NULL,
	"goal_id" uuid NOT NULL,
	"closing_id" uuid,
	"kind" text NOT NULL,
	"trigger" text NOT NULL,
	"status" text DEFAULT 'aberta' NOT NULL,
	"competencias" text[] NOT NULL,
	"owner_id" uuid NOT NULL,
	"subject_user_id" uuid,
	"team_id" uuid,
	"org_unit_id" uuid,
	"due_on" date NOT NULL,
	"escalation_level" integer DEFAULT 0 NOT NULL,
	"escalation_chain" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"diagnosis" text,
	"action_plan" text,
	"plan_due_on" date,
	"review_cause" text,
	"review_decision" text,
	"conclusion" text,
	"resolved_by" uuid,
	"resolved_at" timestamp with time zone,
	"row_version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "interventions_kind_ck" CHECK (kind in ('plano','revisao')),
	CONSTRAINT "interventions_trigger_ck" CHECK (trigger in ('vermelho','amarelos_consecutivos','primeiro_amarelo')),
	CONSTRAINT "interventions_status_ck" CHECK (status in ('aberta','em_andamento','concluida','dispensada')),
	CONSTRAINT "interventions_decision_ck" CHECK (review_decision is null or review_decision in ('manter', 'plano'))
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "intervention_events" ADD CONSTRAINT "intervention_events_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "intervention_events" ADD CONSTRAINT "intervention_events_intervention_id_interventions_id_fk" FOREIGN KEY ("intervention_id") REFERENCES "public"."interventions"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "intervention_events" ADD CONSTRAINT "intervention_events_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "intervention_reads" ADD CONSTRAINT "intervention_reads_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "intervention_reads" ADD CONSTRAINT "intervention_reads_intervention_id_interventions_id_fk" FOREIGN KEY ("intervention_id") REFERENCES "public"."interventions"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "interventions" ADD CONSTRAINT "interventions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "interventions" ADD CONSTRAINT "interventions_goal_id_goals_id_fk" FOREIGN KEY ("goal_id") REFERENCES "public"."goals"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "interventions" ADD CONSTRAINT "interventions_closing_id_result_closings_id_fk" FOREIGN KEY ("closing_id") REFERENCES "public"."result_closings"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "interventions" ADD CONSTRAINT "interventions_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "interventions" ADD CONSTRAINT "interventions_subject_user_id_users_id_fk" FOREIGN KEY ("subject_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "interventions" ADD CONSTRAINT "interventions_resolved_by_users_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "intervention_events_idx" ON "intervention_events" USING btree ("tenant_id","intervention_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "interventions_open_uq" ON "interventions" USING btree ("tenant_id","series_id") WHERE status in ('aberta', 'em_andamento');--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "interventions_idx" ON "interventions" USING btree ("tenant_id","status","owner_id");--> statement-breakpoint
CREATE OR REPLACE FUNCTION isp_forbid_mutation() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE'
     AND TG_TABLE_NAME IN ('opportunity_events', 'activity_events', 'email_messages', 'contract_events', 'contract_versions', 'contract_ledger',
                           'contact_classifications', 'contact_identity_links', 'approval_requests', 'approval_decisions', 'negotiation_messages',
                           'arp_rule_sets', 'arp_item_changes', 'arp_ledger', 'arp_documents', 'arp_events',
                           'cs_assessments', 'cs_presentations', 'cs_surveys', 'project_events',
                           'activity_comments', 'activity_time_entries',
                           'business_events', 'business_event_credits', 'business_event_reviews', 'performance_settings',
                           'indicator_versions', 'scorecard_versions', 'goal_events', 'goal_checkins', 'goal_results', 'org_events', 'result_closings', 'abm_events', 'intervention_events')
     AND current_setting('isp.allow_purge', true) = 'on' THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'Tabela % é append-only (operação % bloqueada)', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'check_violation';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER intervention_events_append_only BEFORE UPDATE OR DELETE ON "intervention_events" FOR EACH ROW EXECUTE FUNCTION isp_forbid_mutation();