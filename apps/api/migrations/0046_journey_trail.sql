CREATE TABLE IF NOT EXISTS "cs_journey_link_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"link_id" uuid NOT NULL,
	"type" text NOT NULL,
	"actor_id" uuid,
	"meta" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cs_journey_link_events_type_ck" CHECK (type in ('criado','acesso','codigo_incorreto','bloqueado','revogado'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "cs_journey_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"journey_id" uuid NOT NULL,
	"label" text NOT NULL,
	"token_hash" text NOT NULL,
	"code_hash" text,
	"show_notes" boolean DEFAULT false NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"failed_attempts" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp with time zone,
	"access_count" integer DEFAULT 0 NOT NULL,
	"last_access_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"revoked_by" uuid,
	"revoke_reason" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "cs_milestone_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"journey_id" uuid NOT NULL,
	"milestone_id" uuid NOT NULL,
	"type" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"actor_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cs_milestone_events_type_ck" CHECK (type in ('concluido','reaberto','reprogramado','responsavel','observacao'))
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "cs_journey_link_events" ADD CONSTRAINT "cs_journey_link_events_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "cs_journey_link_events" ADD CONSTRAINT "cs_journey_link_events_link_id_cs_journey_links_id_fk" FOREIGN KEY ("link_id") REFERENCES "public"."cs_journey_links"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "cs_journey_link_events" ADD CONSTRAINT "cs_journey_link_events_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "cs_journey_links" ADD CONSTRAINT "cs_journey_links_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "cs_journey_links" ADD CONSTRAINT "cs_journey_links_journey_id_cs_journeys_id_fk" FOREIGN KEY ("journey_id") REFERENCES "public"."cs_journeys"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "cs_journey_links" ADD CONSTRAINT "cs_journey_links_revoked_by_users_id_fk" FOREIGN KEY ("revoked_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "cs_journey_links" ADD CONSTRAINT "cs_journey_links_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "cs_milestone_events" ADD CONSTRAINT "cs_milestone_events_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "cs_milestone_events" ADD CONSTRAINT "cs_milestone_events_journey_id_cs_journeys_id_fk" FOREIGN KEY ("journey_id") REFERENCES "public"."cs_journeys"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "cs_milestone_events" ADD CONSTRAINT "cs_milestone_events_milestone_id_cs_milestones_id_fk" FOREIGN KEY ("milestone_id") REFERENCES "public"."cs_milestones"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "cs_milestone_events" ADD CONSTRAINT "cs_milestone_events_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "cs_journey_link_events_idx" ON "cs_journey_link_events" USING btree ("link_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "cs_journey_links_token_uq" ON "cs_journey_links" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "cs_journey_links_idx" ON "cs_journey_links" USING btree ("tenant_id","journey_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "cs_milestone_events_idx" ON "cs_milestone_events" USING btree ("journey_id","created_at");
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
                           'indicator_versions', 'scorecard_versions', 'goal_events', 'goal_checkins', 'goal_results', 'org_events', 'result_closings', 'abm_events', 'intervention_events', 'governance_events', 'stakeholder_influence_history', 'stakeholder_events', 'abm_settings', 'abm_play_versions', 'cs_journey_link_events', 'cs_milestone_events')
     AND current_setting('isp.allow_purge', true) = 'on' THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'Tabela % é append-only (operação % bloqueada)', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'check_violation';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER cs_journey_link_events_append_only BEFORE UPDATE OR DELETE ON "cs_journey_link_events" FOR EACH ROW EXECUTE FUNCTION isp_forbid_mutation();
--> statement-breakpoint
CREATE TRIGGER cs_milestone_events_append_only BEFORE UPDATE OR DELETE ON "cs_milestone_events" FOR EACH ROW EXECUTE FUNCTION isp_forbid_mutation();
--> statement-breakpoint
-- marcos já concluídos ganham o evento de conclusão a partir da data registrada (marcado como reconstituído)
INSERT INTO "cs_milestone_events" ("tenant_id", "journey_id", "milestone_id", "type", "payload", "actor_id", "created_at")
SELECT m."tenant_id", m."journey_id", m."id", 'concluido', jsonb_build_object('to', m."done_at", 'reconstituido', true), m."done_by", m."done_at" FROM "cs_milestones" m WHERE m."done_at" IS NOT NULL;
