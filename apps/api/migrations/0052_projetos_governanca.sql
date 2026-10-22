CREATE TABLE IF NOT EXISTS "milestone_homologations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"milestone_id" uuid NOT NULL,
	"decision" text NOT NULL,
	"note" text NOT NULL,
	"actor_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "milestone_homologations_decision_ck" CHECK (decision in ('homologado','reprovado'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "project_risks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"probability" text NOT NULL,
	"impact" text NOT NULL,
	"mitigation" text,
	"owner_id" uuid NOT NULL,
	"status" text DEFAULT 'aberto' NOT NULL,
	"review_on" date,
	"closed_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"row_version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "project_risks_prob_ck" CHECK (probability in ('baixa','media','alta')),
	CONSTRAINT "project_risks_impact_ck" CHECK (impact in ('baixo','medio','alto')),
	CONSTRAINT "project_risks_status_ck" CHECK (status in ('aberto','em_mitigacao','ocorrido','encerrado'))
);
--> statement-breakpoint
ALTER TABLE "impediments" ADD COLUMN "project_id" uuid;--> statement-breakpoint
ALTER TABLE "impediments" ADD COLUMN "milestone_id" uuid;--> statement-breakpoint
ALTER TABLE "impediments" ADD COLUMN "task_id" uuid;--> statement-breakpoint
ALTER TABLE "project_milestones" ADD COLUMN "acceptance_criteria" text;--> statement-breakpoint
ALTER TABLE "project_milestones" ADD COLUMN "requires_homologation" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "project_milestones" ADD COLUMN "homologated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "project_milestones" ADD COLUMN "homologated_by" uuid;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "milestone_homologations" ADD CONSTRAINT "milestone_homologations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "milestone_homologations" ADD CONSTRAINT "milestone_homologations_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "milestone_homologations" ADD CONSTRAINT "milestone_homologations_milestone_id_project_milestones_id_fk" FOREIGN KEY ("milestone_id") REFERENCES "public"."project_milestones"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "milestone_homologations" ADD CONSTRAINT "milestone_homologations_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "project_risks" ADD CONSTRAINT "project_risks_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "project_risks" ADD CONSTRAINT "project_risks_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "project_risks" ADD CONSTRAINT "project_risks_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "project_risks" ADD CONSTRAINT "project_risks_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "milestone_homologations_idx" ON "milestone_homologations" USING btree ("milestone_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_risks_idx" ON "project_risks" USING btree ("project_id","status");--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "impediments" ADD CONSTRAINT "impediments_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "impediments" ADD CONSTRAINT "impediments_milestone_id_project_milestones_id_fk" FOREIGN KEY ("milestone_id") REFERENCES "public"."project_milestones"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "impediments" ADD CONSTRAINT "impediments_task_id_activities_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."activities"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "project_milestones" ADD CONSTRAINT "project_milestones_homologated_by_users_id_fk" FOREIGN KEY ("homologated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "impediments_project_idx" ON "impediments" USING btree ("project_id");
--> statement-breakpoint
CREATE OR REPLACE FUNCTION isp_forbid_mutation() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE'
     AND TG_TABLE_NAME IN ('opportunity_events', 'activity_events', 'email_messages', 'contract_events', 'contract_versions', 'contract_ledger',
                           'contact_classifications', 'contact_identity_links', 'approval_requests', 'approval_decisions', 'negotiation_messages',
                           'arp_rule_sets', 'arp_item_changes', 'arp_ledger', 'arp_documents', 'arp_events',
                           'cs_assessments', 'cs_presentations', 'cs_surveys', 'project_events',
                           'activity_comments', 'activity_time_entries',
                           'business_events', 'business_event_credits', 'business_event_reviews', 'performance_settings',
                           'indicator_versions', 'scorecard_versions', 'goal_events', 'goal_checkins', 'goal_results', 'org_events', 'result_closings', 'abm_events', 'intervention_events', 'governance_events', 'stakeholder_influence_history', 'stakeholder_events', 'abm_settings', 'abm_play_versions', 'cs_journey_link_events', 'cs_milestone_events', 'survey_versions', 'survey_responses', 'abm_signal_events', 'mail_messages', 'mail_thread_events', 'mail_sync_runs', 'milestone_homologations')
     AND current_setting('isp.allow_purge', true) = 'on' THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'Tabela % é append-only (operação % bloqueada)', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'check_violation';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER milestone_homologations_append_only BEFORE UPDATE OR DELETE ON "milestone_homologations" FOR EACH ROW EXECUTE FUNCTION isp_forbid_mutation();
