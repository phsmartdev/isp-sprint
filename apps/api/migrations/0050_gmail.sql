CREATE TABLE IF NOT EXISTS "mail_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"thread_id" uuid NOT NULL,
	"mailbox_id" uuid NOT NULL,
	"gmail_id" text NOT NULL,
	"rfc_message_id" text,
	"direction" text NOT NULL,
	"from_addr" text NOT NULL,
	"from_name" text,
	"to_addrs" text[] DEFAULT '{}'::text[] NOT NULL,
	"cc_addrs" text[] DEFAULT '{}'::text[] NOT NULL,
	"subject" text DEFAULT '' NOT NULL,
	"sent_at" timestamp with time zone NOT NULL,
	"snippet" text,
	"body_text" text,
	"has_attachments" boolean DEFAULT false NOT NULL,
	"sent_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mail_messages_dir_ck" CHECK (direction in ('entrada','saida'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "mail_queues" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"mailbox_id" uuid,
	"routing" text DEFAULT 'rodizio' NOT NULL,
	"sla_hours" integer DEFAULT 8 NOT NULL,
	"members" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"row_version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "mail_queues_routing_ck" CHECK (routing in ('manual','rodizio','carteira'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "mail_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"mailbox_id" uuid,
	"name" text NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"def" jsonb NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"row_version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "mail_settings" (
	"tenant_id" uuid PRIMARY KEY NOT NULL,
	"allowed_domains" text[] DEFAULT '{}'::text[] NOT NULL,
	"sync_days" integer DEFAULT 30 NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "mail_sync_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"mailbox_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"ok" boolean NOT NULL,
	"fetched" integer DEFAULT 0 NOT NULL,
	"stored" integer DEFAULT 0 NOT NULL,
	"error" text,
	"actor_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "mail_thread_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"thread_id" uuid NOT NULL,
	"type" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"actor_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "mail_threads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"mailbox_id" uuid NOT NULL,
	"gmail_thread_id" text NOT NULL,
	"subject" text DEFAULT '' NOT NULL,
	"snippet" text,
	"participants" text[] DEFAULT '{}'::text[] NOT NULL,
	"last_message_at" timestamp with time zone NOT NULL,
	"first_inbound_at" timestamp with time zone,
	"first_reply_at" timestamp with time zone,
	"first_reply_by" uuid,
	"status" text DEFAULT 'nova' NOT NULL,
	"queue_id" uuid,
	"assignee_id" uuid,
	"assigned_at" timestamp with time zone,
	"priority" text DEFAULT 'normal' NOT NULL,
	"tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"rule_id" uuid,
	"contact_id" uuid,
	"opportunity_id" uuid,
	"contract_id" uuid,
	"link_source" text,
	"link_ambiguous" boolean DEFAULT false NOT NULL,
	"unread" boolean DEFAULT true NOT NULL,
	"resolved_at" timestamp with time zone,
	"resolved_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"row_version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "mail_threads_status_ck" CHECK (status in ('nova','em_atendimento','aguardando_cliente','resolvida','arquivada')),
	CONSTRAINT "mail_threads_prio_ck" CHECK (priority in ('alta','normal','baixa'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "mailboxes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"address" text NOT NULL,
	"display_name" text,
	"owner_id" uuid,
	"status" text DEFAULT 'desconectada' NOT NULL,
	"refresh_token_enc" text,
	"access_token_enc" text,
	"access_expires_at" timestamp with time zone,
	"granted_scopes" text,
	"history_id" text,
	"last_sync_at" timestamp with time zone,
	"last_error" text,
	"connected_by" uuid,
	"connected_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"row_version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "mailboxes_kind_ck" CHECK (kind in ('pessoal','compartilhada')),
	CONSTRAINT "mailboxes_status_ck" CHECK (status in ('desconectada','conectada','erro','pausada'))
);
--> statement-breakpoint
ALTER TABLE "access_policies" DROP CONSTRAINT "access_module_ck";--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "mail_messages" ADD CONSTRAINT "mail_messages_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "mail_messages" ADD CONSTRAINT "mail_messages_thread_id_mail_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."mail_threads"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "mail_messages" ADD CONSTRAINT "mail_messages_mailbox_id_mailboxes_id_fk" FOREIGN KEY ("mailbox_id") REFERENCES "public"."mailboxes"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "mail_messages" ADD CONSTRAINT "mail_messages_sent_by_users_id_fk" FOREIGN KEY ("sent_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "mail_queues" ADD CONSTRAINT "mail_queues_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "mail_queues" ADD CONSTRAINT "mail_queues_mailbox_id_mailboxes_id_fk" FOREIGN KEY ("mailbox_id") REFERENCES "public"."mailboxes"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "mail_queues" ADD CONSTRAINT "mail_queues_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "mail_rules" ADD CONSTRAINT "mail_rules_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "mail_rules" ADD CONSTRAINT "mail_rules_mailbox_id_mailboxes_id_fk" FOREIGN KEY ("mailbox_id") REFERENCES "public"."mailboxes"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "mail_rules" ADD CONSTRAINT "mail_rules_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "mail_settings" ADD CONSTRAINT "mail_settings_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "mail_settings" ADD CONSTRAINT "mail_settings_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "mail_sync_runs" ADD CONSTRAINT "mail_sync_runs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "mail_sync_runs" ADD CONSTRAINT "mail_sync_runs_mailbox_id_mailboxes_id_fk" FOREIGN KEY ("mailbox_id") REFERENCES "public"."mailboxes"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "mail_sync_runs" ADD CONSTRAINT "mail_sync_runs_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "mail_thread_events" ADD CONSTRAINT "mail_thread_events_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "mail_thread_events" ADD CONSTRAINT "mail_thread_events_thread_id_mail_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."mail_threads"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "mail_thread_events" ADD CONSTRAINT "mail_thread_events_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "mail_threads" ADD CONSTRAINT "mail_threads_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "mail_threads" ADD CONSTRAINT "mail_threads_mailbox_id_mailboxes_id_fk" FOREIGN KEY ("mailbox_id") REFERENCES "public"."mailboxes"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "mail_threads" ADD CONSTRAINT "mail_threads_first_reply_by_users_id_fk" FOREIGN KEY ("first_reply_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "mail_threads" ADD CONSTRAINT "mail_threads_queue_id_mail_queues_id_fk" FOREIGN KEY ("queue_id") REFERENCES "public"."mail_queues"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "mail_threads" ADD CONSTRAINT "mail_threads_assignee_id_users_id_fk" FOREIGN KEY ("assignee_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "mail_threads" ADD CONSTRAINT "mail_threads_rule_id_mail_rules_id_fk" FOREIGN KEY ("rule_id") REFERENCES "public"."mail_rules"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "mail_threads" ADD CONSTRAINT "mail_threads_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "mail_threads" ADD CONSTRAINT "mail_threads_opportunity_id_opportunities_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."opportunities"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "mail_threads" ADD CONSTRAINT "mail_threads_resolved_by_users_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "mailboxes" ADD CONSTRAINT "mailboxes_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "mailboxes" ADD CONSTRAINT "mailboxes_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "mailboxes" ADD CONSTRAINT "mailboxes_connected_by_users_id_fk" FOREIGN KEY ("connected_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "mailboxes" ADD CONSTRAINT "mailboxes_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "mail_messages_gmail_uq" ON "mail_messages" USING btree ("mailbox_id","gmail_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "mail_messages_thread_idx" ON "mail_messages" USING btree ("thread_id","sent_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "mail_queues_idx" ON "mail_queues" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "mail_rules_idx" ON "mail_rules" USING btree ("tenant_id","position");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "mail_sync_runs_idx" ON "mail_sync_runs" USING btree ("mailbox_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "mail_thread_events_idx" ON "mail_thread_events" USING btree ("thread_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "mail_threads_gmail_uq" ON "mail_threads" USING btree ("mailbox_id","gmail_thread_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "mail_threads_list_idx" ON "mail_threads" USING btree ("tenant_id","status","last_message_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "mail_threads_contact_idx" ON "mail_threads" USING btree ("tenant_id","contact_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "mailboxes_addr_uq" ON "mailboxes" USING btree ("tenant_id","address");--> statement-breakpoint
ALTER TABLE "access_policies" ADD CONSTRAINT "access_module_ck" CHECK (module in ('inicio','leads','oportunidades','clientes','atividades','relatorios','campanhas','contratos','projetos','desempenho','resultados','inteligencia','email','configuracoes'));
--> statement-breakpoint
INSERT INTO "access_policies" ("role_id", "module", "level")
SELECT r.id, 'email', CASE r.key WHEN 'gerencia' THEN 'total' WHEN 'supervisor' THEN 'equipe' WHEN 'vendedor' THEN 'proprio' ELSE 'nenhum' END
FROM "roles" r ON CONFLICT DO NOTHING;
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
                           'indicator_versions', 'scorecard_versions', 'goal_events', 'goal_checkins', 'goal_results', 'org_events', 'result_closings', 'abm_events', 'intervention_events', 'governance_events', 'stakeholder_influence_history', 'stakeholder_events', 'abm_settings', 'abm_play_versions', 'cs_journey_link_events', 'cs_milestone_events', 'survey_versions', 'survey_responses', 'abm_signal_events', 'mail_messages', 'mail_thread_events', 'mail_sync_runs')
     AND current_setting('isp.allow_purge', true) = 'on' THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'Tabela % é append-only (operação % bloqueada)', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'check_violation';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER mail_messages_append_only BEFORE UPDATE OR DELETE ON "mail_messages" FOR EACH ROW EXECUTE FUNCTION isp_forbid_mutation();
--> statement-breakpoint
CREATE TRIGGER mail_thread_events_append_only BEFORE UPDATE OR DELETE ON "mail_thread_events" FOR EACH ROW EXECUTE FUNCTION isp_forbid_mutation();
--> statement-breakpoint
CREATE TRIGGER mail_sync_runs_append_only BEFORE UPDATE OR DELETE ON "mail_sync_runs" FOR EACH ROW EXECUTE FUNCTION isp_forbid_mutation();
