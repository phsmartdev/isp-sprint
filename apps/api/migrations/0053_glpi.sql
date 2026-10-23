CREATE TABLE IF NOT EXISTS "glpi_ticket_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"ticket_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"external_id" text NOT NULL,
	"direction" text DEFAULT 'entrada' NOT NULL,
	"author" text,
	"text" text DEFAULT '' NOT NULL,
	"is_private" boolean DEFAULT false NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"actor_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "glpi_tickets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"opportunity_id" uuid NOT NULL,
	"customer_id" uuid,
	"glpi_id" integer NOT NULL,
	"entity_id" integer NOT NULL,
	"entity_name" text,
	"category_id" integer,
	"category_name" text,
	"group_id" integer,
	"group_name" text,
	"type" integer NOT NULL,
	"urgency" integer NOT NULL,
	"title" text NOT NULL,
	"status" integer,
	"status_name" text,
	"solved_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"glpi_updated_at" text,
	"last_sync_at" timestamp with time zone,
	"sync_error" text,
	"unseen" integer DEFAULT 0 NOT NULL,
	"opened_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "glpi_ticket_events" ADD CONSTRAINT "glpi_ticket_events_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "glpi_ticket_events" ADD CONSTRAINT "glpi_ticket_events_ticket_id_glpi_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."glpi_tickets"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "glpi_ticket_events" ADD CONSTRAINT "glpi_ticket_events_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "glpi_tickets" ADD CONSTRAINT "glpi_tickets_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "glpi_tickets" ADD CONSTRAINT "glpi_tickets_opportunity_id_opportunities_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."opportunities"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "glpi_tickets" ADD CONSTRAINT "glpi_tickets_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "glpi_tickets" ADD CONSTRAINT "glpi_tickets_opened_by_users_id_fk" FOREIGN KEY ("opened_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "glpi_ticket_events_uq" ON "glpi_ticket_events" USING btree ("ticket_id","external_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "glpi_tickets_uq" ON "glpi_tickets" USING btree ("tenant_id","glpi_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "glpi_tickets_opp_idx" ON "glpi_tickets" USING btree ("opportunity_id");
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
                           'indicator_versions', 'scorecard_versions', 'goal_events', 'goal_checkins', 'goal_results', 'org_events', 'result_closings', 'abm_events', 'intervention_events', 'governance_events', 'stakeholder_influence_history', 'stakeholder_events', 'abm_settings', 'abm_play_versions', 'cs_journey_link_events', 'cs_milestone_events', 'survey_versions', 'survey_responses', 'abm_signal_events', 'mail_messages', 'mail_thread_events', 'mail_sync_runs', 'milestone_homologations','glpi_ticket_events')
     AND current_setting('isp.allow_purge', true) = 'on' THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'Tabela % é append-only (operação % bloqueada)', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'check_violation';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER glpi_ticket_events_append_only BEFORE UPDATE OR DELETE ON "glpi_ticket_events" FOR EACH ROW EXECUTE FUNCTION isp_forbid_mutation();
