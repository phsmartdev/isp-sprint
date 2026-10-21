CREATE TABLE IF NOT EXISTS "goal_revision_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"goal_id" uuid NOT NULL,
	"requested_by" uuid NOT NULL,
	"from_target" double precision NOT NULL,
	"to_target" double precision NOT NULL,
	"reason" text NOT NULL,
	"status" text DEFAULT 'pendente' NOT NULL,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"decision_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "goal_revision_requests_status_ck" CHECK (status in ('pendente','aprovada','recusada'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "result_closings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"goal_id" uuid NOT NULL,
	"series_id" uuid,
	"competencia" text NOT NULL,
	"version" integer NOT NULL,
	"status" text NOT NULL,
	"value" double precision,
	"target" double precision NOT NULL,
	"attainment" double precision,
	"color" text NOT NULL,
	"indicator_version" integer,
	"sample" integer,
	"quality" text DEFAULT 'ok' NOT NULL,
	"reason" text,
	"actor_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "result_closings_status_ck" CHECK (status in ('consolidado','validado','retificado')),
	CONSTRAINT "result_closings_color_ck" CHECK (color in ('verde','amarelo','vermelho','sem_dado'))
);
--> statement-breakpoint
ALTER TABLE "goals" DROP CONSTRAINT "goals_scope_ck";--> statement-breakpoint
ALTER TABLE "goals" ADD COLUMN "org_unit_id" uuid;--> statement-breakpoint
ALTER TABLE "goals" ADD COLUMN "recurring" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "goals" ADD COLUMN "series_id" uuid;--> statement-breakpoint
ALTER TABLE "goals" ADD COLUMN "approval_status" text DEFAULT 'aprovada' NOT NULL;--> statement-breakpoint
ALTER TABLE "goals" ADD COLUMN "approved_by" uuid;--> statement-breakpoint
ALTER TABLE "goals" ADD COLUMN "approved_at" timestamp with time zone;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "goal_revision_requests" ADD CONSTRAINT "goal_revision_requests_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "goal_revision_requests" ADD CONSTRAINT "goal_revision_requests_goal_id_goals_id_fk" FOREIGN KEY ("goal_id") REFERENCES "public"."goals"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "goal_revision_requests" ADD CONSTRAINT "goal_revision_requests_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "goal_revision_requests" ADD CONSTRAINT "goal_revision_requests_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "result_closings" ADD CONSTRAINT "result_closings_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "result_closings" ADD CONSTRAINT "result_closings_goal_id_goals_id_fk" FOREIGN KEY ("goal_id") REFERENCES "public"."goals"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "result_closings" ADD CONSTRAINT "result_closings_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "goal_revision_requests_idx" ON "goal_revision_requests" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "result_closings_uq" ON "result_closings" USING btree ("goal_id","version");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "result_closings_series_idx" ON "result_closings" USING btree ("tenant_id","series_id","competencia");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "goals_series_uq" ON "goals" USING btree ("tenant_id","series_id","period_start") WHERE series_id is not null;--> statement-breakpoint
ALTER TABLE "goals" ADD CONSTRAINT "goals_approval_ck" CHECK (approval_status in ('proposta','aprovada','rejeitada'));--> statement-breakpoint
ALTER TABLE "goals" ADD CONSTRAINT "goals_scope_ck" CHECK (scope in ('individual','equipe','unidade','empresa'));--> statement-breakpoint
UPDATE "goals" SET "series_id" = "id" WHERE "series_id" IS NULL;
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
                           'indicator_versions', 'scorecard_versions', 'goal_events', 'goal_checkins', 'goal_results', 'org_events', 'result_closings')
     AND current_setting('isp.allow_purge', true) = 'on' THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'Tabela % é append-only (operação % bloqueada)', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'check_violation';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER result_closings_append_only BEFORE UPDATE OR DELETE ON "result_closings" FOR EACH ROW EXECUTE FUNCTION isp_forbid_mutation();
