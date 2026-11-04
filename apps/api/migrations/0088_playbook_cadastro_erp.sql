CREATE TABLE IF NOT EXISTS "contract_erp_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"record_id" uuid NOT NULL,
	"contract_id" uuid NOT NULL,
	"action" text NOT NULL,
	"from_status" text,
	"to_status" text,
	"actor_id" uuid,
	"note" text,
	"data" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "contract_erp_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"contract_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"cycle" text DEFAULT 'implantacao' NOT NULL,
	"status" text DEFAULT 'nao_iniciado' NOT NULL,
	"values" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"items" jsonb,
	"extras" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"secret_enc" text,
	"evidence_doc_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"editors" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"submitted_by" uuid,
	"submitted_at" timestamp with time zone,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"approved_snapshot" jsonb,
	"approved_hash" text,
	"first_pass" boolean,
	"launcher_id" uuid,
	"launched_by" uuid,
	"launched_at" timestamp with time zone,
	"ixc_client_id" text,
	"ixc_contract_id" text,
	"checked_by" uuid,
	"checked_at" timestamp with time zone,
	"last_compare" jsonb,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"row_version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "contract_erp_records_status_ck" CHECK (status in ('nao_iniciado','em_preenchimento','aguardando_conferencia','devolvido','aprovado','aguardando_lancamento','lancado','conferido_ixc','divergente')),
	CONSTRAINT "contract_erp_records_cycle_ck" CHECK (cycle in ('implantacao','aditivo','reajuste','renovacao'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "playbook_role_holders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"role" text NOT NULL,
	"user_id" uuid,
	"external_name" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "playbook_role_holders_one_ck" CHECK ((user_id is null) <> (external_name is null))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "raci_settings" (
	"tenant_id" uuid NOT NULL,
	"activity_key" text NOT NULL,
	"sla_hours" integer,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "raci_settings_sla_ck" CHECK (sla_hours is null or sla_hours > 0)
);
--> statement-breakpoint
ALTER TABLE "activities" ADD COLUMN "accept_status" text;--> statement-breakpoint
ALTER TABLE "activities" ADD COLUMN "handoff_from" uuid;--> statement-breakpoint
ALTER TABLE "activities" ADD COLUMN "accepted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "activities" ADD COLUMN "accepted_by" uuid;--> statement-breakpoint
ALTER TABLE "activities" ADD COLUMN "return_reason" text;--> statement-breakpoint
ALTER TABLE "activities" ADD COLUMN "raci_key" text;--> statement-breakpoint
ALTER TABLE "activities" ADD COLUMN "evidence_required" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "contracts" ADD COLUMN "admin_owner_id" uuid;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "contract_erp_events" ADD CONSTRAINT "contract_erp_events_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "contract_erp_events" ADD CONSTRAINT "contract_erp_events_record_id_contract_erp_records_id_fk" FOREIGN KEY ("record_id") REFERENCES "public"."contract_erp_records"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "contract_erp_events" ADD CONSTRAINT "contract_erp_events_contract_id_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."contracts"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "contract_erp_events" ADD CONSTRAINT "contract_erp_events_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "contract_erp_records" ADD CONSTRAINT "contract_erp_records_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "contract_erp_records" ADD CONSTRAINT "contract_erp_records_contract_id_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."contracts"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "contract_erp_records" ADD CONSTRAINT "contract_erp_records_submitted_by_users_id_fk" FOREIGN KEY ("submitted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "contract_erp_records" ADD CONSTRAINT "contract_erp_records_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "contract_erp_records" ADD CONSTRAINT "contract_erp_records_launcher_id_users_id_fk" FOREIGN KEY ("launcher_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "contract_erp_records" ADD CONSTRAINT "contract_erp_records_launched_by_users_id_fk" FOREIGN KEY ("launched_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "contract_erp_records" ADD CONSTRAINT "contract_erp_records_checked_by_users_id_fk" FOREIGN KEY ("checked_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "contract_erp_records" ADD CONSTRAINT "contract_erp_records_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "playbook_role_holders" ADD CONSTRAINT "playbook_role_holders_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "playbook_role_holders" ADD CONSTRAINT "playbook_role_holders_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "playbook_role_holders" ADD CONSTRAINT "playbook_role_holders_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "raci_settings" ADD CONSTRAINT "raci_settings_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "raci_settings" ADD CONSTRAINT "raci_settings_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "contract_erp_events_idx" ON "contract_erp_events" USING btree ("tenant_id","record_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "contract_erp_records_uq" ON "contract_erp_records" USING btree ("contract_id","seq");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "contract_erp_records_idx" ON "contract_erp_records" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "playbook_role_holders_idx" ON "playbook_role_holders" USING btree ("tenant_id","role");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "playbook_role_holders_user_uq" ON "playbook_role_holders" USING btree ("tenant_id","role","user_id") WHERE user_id is not null;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "raci_settings_pk" ON "raci_settings" USING btree ("tenant_id","activity_key");--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "activities" ADD CONSTRAINT "activities_handoff_from_users_id_fk" FOREIGN KEY ("handoff_from") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "activities" ADD CONSTRAINT "activities_accepted_by_users_id_fk" FOREIGN KEY ("accepted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "contracts" ADD CONSTRAINT "contracts_admin_owner_id_users_id_fk" FOREIGN KEY ("admin_owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
ALTER TABLE "activities" ADD CONSTRAINT "activities_accept_ck" CHECK (accept_status is null or accept_status in ('pendente','aceita','devolvida'));--> statement-breakpoint
-- histórico do Cadastro ERP: append-only, apagado só na limpeza de base (isp.allow_purge)
CREATE OR REPLACE FUNCTION isp_forbid_mutation() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE'
     AND TG_TABLE_NAME IN ('opportunity_events', 'activity_events', 'email_messages', 'contract_events', 'contract_versions', 'contract_ledger',
                           'contact_classifications', 'contact_identity_links', 'approval_requests', 'approval_decisions', 'negotiation_messages',
                           'arp_rule_sets', 'arp_item_changes', 'arp_ledger', 'arp_documents', 'arp_events',
                           'cs_assessments', 'cs_presentations', 'cs_surveys', 'project_events',
                           'activity_comments', 'activity_time_entries',
                           'business_events', 'business_event_credits', 'business_event_reviews', 'performance_settings',
                           'indicator_versions', 'scorecard_versions', 'goal_events', 'goal_checkins', 'goal_results', 'org_events', 'result_closings', 'abm_events', 'intervention_events', 'governance_events', 'stakeholder_influence_history', 'stakeholder_events', 'abm_settings', 'abm_play_versions', 'cs_journey_link_events', 'cs_milestone_events', 'survey_versions', 'survey_responses', 'abm_signal_events', 'mail_messages', 'mail_thread_events', 'mail_sync_runs', 'milestone_homologations','glpi_ticket_events', 'contract_erp_events')
     AND current_setting('isp.allow_purge', true) = 'on' THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'Tabela % é append-only (operação % bloqueada)', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'check_violation';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER contract_erp_events_append_only BEFORE UPDATE OR DELETE ON contract_erp_events FOR EACH ROW EXECUTE FUNCTION isp_forbid_mutation();