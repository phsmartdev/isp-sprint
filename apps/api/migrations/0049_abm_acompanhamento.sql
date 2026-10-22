CREATE TABLE IF NOT EXISTS "abm_cadence_tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"cadence_id" uuid NOT NULL,
	"due_on" date NOT NULL,
	"activity_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "abm_cadences" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"abm_id" uuid NOT NULL,
	"contact_id" uuid NOT NULL,
	"stakeholder_id" uuid,
	"title" text NOT NULL,
	"type" text NOT NULL,
	"every_days" integer NOT NULL,
	"owner_id" uuid NOT NULL,
	"start_on" date NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_by" uuid,
	"row_version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "abm_cadences_type_ck" CHECK (type in ('ligacao','reuniao','visita','email','whatsapp','tarefa'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "abm_signal_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"signal_id" uuid NOT NULL,
	"type" text NOT NULL,
	"note" text,
	"actor_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "abm_signals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"abm_id" uuid NOT NULL,
	"contact_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"key" text NOT NULL,
	"severity" text NOT NULL,
	"title" text NOT NULL,
	"detail" text,
	"ref" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'novo' NOT NULL,
	"owner_id" uuid,
	"detected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_at" timestamp with time zone,
	"closed_by" uuid,
	"resolution" text,
	"suppress_until" timestamp with time zone,
	"task_id" uuid,
	"created_by" uuid,
	"row_version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "abm_signals_status_ck" CHECK (status in ('novo','em_analise','tratado','descartado','resolvido')),
	CONSTRAINT "abm_signals_sev_ck" CHECK (severity in ('alta','media','baixa'))
);
--> statement-breakpoint
ALTER TABLE "activities" ADD COLUMN "stakeholder_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "abm_cadence_tasks" ADD CONSTRAINT "abm_cadence_tasks_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "abm_cadence_tasks" ADD CONSTRAINT "abm_cadence_tasks_cadence_id_abm_cadences_id_fk" FOREIGN KEY ("cadence_id") REFERENCES "public"."abm_cadences"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "abm_cadence_tasks" ADD CONSTRAINT "abm_cadence_tasks_activity_id_activities_id_fk" FOREIGN KEY ("activity_id") REFERENCES "public"."activities"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "abm_cadences" ADD CONSTRAINT "abm_cadences_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "abm_cadences" ADD CONSTRAINT "abm_cadences_abm_id_abm_accounts_id_fk" FOREIGN KEY ("abm_id") REFERENCES "public"."abm_accounts"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "abm_cadences" ADD CONSTRAINT "abm_cadences_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "abm_cadences" ADD CONSTRAINT "abm_cadences_stakeholder_id_account_stakeholders_id_fk" FOREIGN KEY ("stakeholder_id") REFERENCES "public"."account_stakeholders"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "abm_cadences" ADD CONSTRAINT "abm_cadences_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "abm_cadences" ADD CONSTRAINT "abm_cadences_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "abm_signal_events" ADD CONSTRAINT "abm_signal_events_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "abm_signal_events" ADD CONSTRAINT "abm_signal_events_signal_id_abm_signals_id_fk" FOREIGN KEY ("signal_id") REFERENCES "public"."abm_signals"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "abm_signal_events" ADD CONSTRAINT "abm_signal_events_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "abm_signals" ADD CONSTRAINT "abm_signals_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "abm_signals" ADD CONSTRAINT "abm_signals_abm_id_abm_accounts_id_fk" FOREIGN KEY ("abm_id") REFERENCES "public"."abm_accounts"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "abm_signals" ADD CONSTRAINT "abm_signals_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "abm_signals" ADD CONSTRAINT "abm_signals_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "abm_signals" ADD CONSTRAINT "abm_signals_closed_by_users_id_fk" FOREIGN KEY ("closed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "abm_signals" ADD CONSTRAINT "abm_signals_task_id_activities_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."activities"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "abm_signals" ADD CONSTRAINT "abm_signals_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "abm_cadence_tasks_uq" ON "abm_cadence_tasks" USING btree ("cadence_id","due_on");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "abm_cadences_idx" ON "abm_cadences" USING btree ("tenant_id","contact_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "abm_signal_events_idx" ON "abm_signal_events" USING btree ("signal_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "abm_signals_open_uq" ON "abm_signals" USING btree ("abm_id","key") WHERE status in ('novo', 'em_analise');--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "abm_signals_idx" ON "abm_signals" USING btree ("tenant_id","status");
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
                           'indicator_versions', 'scorecard_versions', 'goal_events', 'goal_checkins', 'goal_results', 'org_events', 'result_closings', 'abm_events', 'intervention_events', 'governance_events', 'stakeholder_influence_history', 'stakeholder_events', 'abm_settings', 'abm_play_versions', 'cs_journey_link_events', 'cs_milestone_events', 'survey_versions', 'survey_responses', 'abm_signal_events')
     AND current_setting('isp.allow_purge', true) = 'on' THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'Tabela % é append-only (operação % bloqueada)', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'check_violation';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER abm_signal_events_append_only BEFORE UPDATE OR DELETE ON "abm_signal_events" FOR EACH ROW EXECUTE FUNCTION isp_forbid_mutation();
