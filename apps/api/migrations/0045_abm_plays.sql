CREATE TABLE IF NOT EXISTS "abm_play_run_steps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"step_key" text NOT NULL,
	"position" integer NOT NULL,
	"activity_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "abm_play_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"play_id" uuid NOT NULL,
	"play_version" integer NOT NULL,
	"abm_id" uuid NOT NULL,
	"contact_id" uuid NOT NULL,
	"stakeholder_id" uuid,
	"owner_id" uuid NOT NULL,
	"status" text DEFAULT 'em_andamento' NOT NULL,
	"start_on" date NOT NULL,
	"reason" text NOT NULL,
	"from_suggestion" boolean DEFAULT false NOT NULL,
	"outcome" text,
	"success_achieved" boolean,
	"closed_at" timestamp with time zone,
	"closed_by" uuid,
	"created_by" uuid,
	"row_version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "abm_play_runs_status_ck" CHECK (status in ('em_andamento','concluido','cancelado'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "abm_play_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"play_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"definition" jsonb NOT NULL,
	"note" text NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "abm_plays" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"template_key" text,
	"name" text NOT NULL,
	"category" text NOT NULL,
	"objective" text DEFAULT '' NOT NULL,
	"target" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"current_version" integer DEFAULT 1 NOT NULL,
	"created_by" uuid,
	"row_version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "abm_plays_category_ck" CHECK (category in ('abertura','mapeamento','aproximacao','conversao','defensores','expansao','renovacao','reativacao','institucional','outro')),
	CONSTRAINT "abm_plays_target_ck" CHECK (target in ('conta','stakeholder'))
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "abm_play_run_steps" ADD CONSTRAINT "abm_play_run_steps_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "abm_play_run_steps" ADD CONSTRAINT "abm_play_run_steps_run_id_abm_play_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."abm_play_runs"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "abm_play_run_steps" ADD CONSTRAINT "abm_play_run_steps_activity_id_activities_id_fk" FOREIGN KEY ("activity_id") REFERENCES "public"."activities"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "abm_play_runs" ADD CONSTRAINT "abm_play_runs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "abm_play_runs" ADD CONSTRAINT "abm_play_runs_play_id_abm_plays_id_fk" FOREIGN KEY ("play_id") REFERENCES "public"."abm_plays"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "abm_play_runs" ADD CONSTRAINT "abm_play_runs_abm_id_abm_accounts_id_fk" FOREIGN KEY ("abm_id") REFERENCES "public"."abm_accounts"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "abm_play_runs" ADD CONSTRAINT "abm_play_runs_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "abm_play_runs" ADD CONSTRAINT "abm_play_runs_stakeholder_id_account_stakeholders_id_fk" FOREIGN KEY ("stakeholder_id") REFERENCES "public"."account_stakeholders"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "abm_play_runs" ADD CONSTRAINT "abm_play_runs_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "abm_play_runs" ADD CONSTRAINT "abm_play_runs_closed_by_users_id_fk" FOREIGN KEY ("closed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "abm_play_runs" ADD CONSTRAINT "abm_play_runs_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "abm_play_versions" ADD CONSTRAINT "abm_play_versions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "abm_play_versions" ADD CONSTRAINT "abm_play_versions_play_id_abm_plays_id_fk" FOREIGN KEY ("play_id") REFERENCES "public"."abm_plays"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "abm_play_versions" ADD CONSTRAINT "abm_play_versions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "abm_plays" ADD CONSTRAINT "abm_plays_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "abm_plays" ADD CONSTRAINT "abm_plays_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "abm_play_run_steps_uq" ON "abm_play_run_steps" USING btree ("run_id","step_key");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "abm_play_run_steps_act_idx" ON "abm_play_run_steps" USING btree ("activity_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "abm_play_runs_idx" ON "abm_play_runs" USING btree ("tenant_id","contact_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "abm_play_runs_open_uq" ON "abm_play_runs" USING btree ("play_id","contact_id",coalesce(stakeholder_id, '00000000-0000-0000-0000-000000000000'::uuid)) WHERE status = 'em_andamento';--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "abm_play_versions_uq" ON "abm_play_versions" USING btree ("play_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "abm_plays_name_uq" ON "abm_plays" USING btree ("tenant_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "abm_plays_template_uq" ON "abm_plays" USING btree ("tenant_id","template_key") WHERE template_key is not null;
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
                           'indicator_versions', 'scorecard_versions', 'goal_events', 'goal_checkins', 'goal_results', 'org_events', 'result_closings', 'abm_events', 'intervention_events', 'governance_events', 'stakeholder_influence_history', 'stakeholder_events', 'abm_settings', 'abm_play_versions')
     AND current_setting('isp.allow_purge', true) = 'on' THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'Tabela % é append-only (operação % bloqueada)', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'check_violation';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER abm_play_versions_append_only BEFORE UPDATE OR DELETE ON "abm_play_versions" FOR EACH ROW EXECUTE FUNCTION isp_forbid_mutation();
