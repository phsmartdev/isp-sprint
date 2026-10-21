CREATE TABLE IF NOT EXISTS "abm_settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"config" jsonb NOT NULL,
	"note" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "account_stakeholders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"contact_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"title" text,
	"unit_id" uuid,
	"roles" text[] DEFAULT '{}'::text[] NOT NULL,
	"custom_roles" text[] DEFAULT '{}'::text[] NOT NULL,
	"interest" text DEFAULT 'desconhecido' NOT NULL,
	"stance" text DEFAULT 'desconhecido' NOT NULL,
	"relationship_strength" text DEFAULT 'nao_avaliado' NOT NULL,
	"access" text DEFAULT 'nao_avaliado' NOT NULL,
	"participation" text DEFAULT 'nao_avaliado' NOT NULL,
	"priority" text DEFAULT 'media' NOT NULL,
	"relationship_owner_id" uuid,
	"next_interaction_on" date,
	"notes" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_by" uuid,
	"row_version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "account_stakeholders_interest_ck" CHECK (interest in ('alto','medio','baixo','desconhecido')),
	CONSTRAINT "account_stakeholders_stance_ck" CHECK (stance in ('defensor','favoravel','neutro','resistente','opositor','desconhecido')),
	CONSTRAINT "account_stakeholders_rel_ck" CHECK (relationship_strength in ('forte','moderado','fraco','inexistente','nao_avaliado')),
	CONSTRAINT "account_stakeholders_access_ck" CHECK (access in ('direto','indireto','sem_acesso','nao_avaliado')),
	CONSTRAINT "account_stakeholders_part_ck" CHECK (participation in ('ativo','ocasional','inativo','nao_avaliado')),
	CONSTRAINT "account_stakeholders_prio_ck" CHECK (priority in ('critica','alta','media','baixa'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "influence_change_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"stakeholder_id" uuid NOT NULL,
	"context_type" text NOT NULL,
	"context_key" text DEFAULT '' NOT NULL,
	"context_label" text,
	"from_level" text NOT NULL,
	"to_level" text NOT NULL,
	"justification" text NOT NULL,
	"evidence" text,
	"requested_by" uuid NOT NULL,
	"status" text DEFAULT 'pendente' NOT NULL,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"decision_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "influence_change_requests_status_ck" CHECK (status in ('pendente','aprovada','recusada'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "people" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"email" text,
	"phone" text,
	"notes" text,
	"source_system" text DEFAULT 'crm' NOT NULL,
	"external_id" text,
	"created_by" uuid,
	"row_version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "stakeholder_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"stakeholder_id" uuid NOT NULL,
	"type" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"actor_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "stakeholder_influence" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"stakeholder_id" uuid NOT NULL,
	"context_type" text NOT NULL,
	"context_key" text DEFAULT '' NOT NULL,
	"context_label" text,
	"level" text NOT NULL,
	"updated_by" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"row_version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "stakeholder_influence_level_ck" CHECK (level in ('muito_alto','alto','medio','baixo','muito_baixo','nao_avaliado')),
	CONSTRAINT "stakeholder_influence_ctx_ck" CHECK (context_type in ('conta','unidade','oportunidade','projeto','processo'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "stakeholder_influence_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"stakeholder_id" uuid NOT NULL,
	"context_type" text NOT NULL,
	"context_key" text DEFAULT '' NOT NULL,
	"context_label" text,
	"from_level" text NOT NULL,
	"to_level" text NOT NULL,
	"justification" text NOT NULL,
	"evidence" text,
	"actor_id" uuid NOT NULL,
	"approved_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "stakeholder_relations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"contact_id" uuid NOT NULL,
	"from_id" uuid NOT NULL,
	"to_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"notes" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stakeholder_relations_kind_ck" CHECK (kind in ('reporta_a','influencia','aliado','conflito','indicou','outro')),
	CONSTRAINT "stakeholder_relations_self_ck" CHECK (from_id <> to_id)
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "abm_settings" ADD CONSTRAINT "abm_settings_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "abm_settings" ADD CONSTRAINT "abm_settings_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "account_stakeholders" ADD CONSTRAINT "account_stakeholders_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "account_stakeholders" ADD CONSTRAINT "account_stakeholders_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "account_stakeholders" ADD CONSTRAINT "account_stakeholders_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "account_stakeholders" ADD CONSTRAINT "account_stakeholders_unit_id_account_org_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."account_org_units"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "account_stakeholders" ADD CONSTRAINT "account_stakeholders_relationship_owner_id_users_id_fk" FOREIGN KEY ("relationship_owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "account_stakeholders" ADD CONSTRAINT "account_stakeholders_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "influence_change_requests" ADD CONSTRAINT "influence_change_requests_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "influence_change_requests" ADD CONSTRAINT "influence_change_requests_stakeholder_id_account_stakeholders_id_fk" FOREIGN KEY ("stakeholder_id") REFERENCES "public"."account_stakeholders"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "influence_change_requests" ADD CONSTRAINT "influence_change_requests_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "influence_change_requests" ADD CONSTRAINT "influence_change_requests_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "people" ADD CONSTRAINT "people_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "people" ADD CONSTRAINT "people_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "stakeholder_events" ADD CONSTRAINT "stakeholder_events_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "stakeholder_events" ADD CONSTRAINT "stakeholder_events_stakeholder_id_account_stakeholders_id_fk" FOREIGN KEY ("stakeholder_id") REFERENCES "public"."account_stakeholders"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "stakeholder_events" ADD CONSTRAINT "stakeholder_events_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "stakeholder_influence" ADD CONSTRAINT "stakeholder_influence_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "stakeholder_influence" ADD CONSTRAINT "stakeholder_influence_stakeholder_id_account_stakeholders_id_fk" FOREIGN KEY ("stakeholder_id") REFERENCES "public"."account_stakeholders"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "stakeholder_influence" ADD CONSTRAINT "stakeholder_influence_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "stakeholder_influence_history" ADD CONSTRAINT "stakeholder_influence_history_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "stakeholder_influence_history" ADD CONSTRAINT "stakeholder_influence_history_stakeholder_id_account_stakeholders_id_fk" FOREIGN KEY ("stakeholder_id") REFERENCES "public"."account_stakeholders"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "stakeholder_influence_history" ADD CONSTRAINT "stakeholder_influence_history_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "stakeholder_influence_history" ADD CONSTRAINT "stakeholder_influence_history_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "stakeholder_relations" ADD CONSTRAINT "stakeholder_relations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "stakeholder_relations" ADD CONSTRAINT "stakeholder_relations_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "stakeholder_relations" ADD CONSTRAINT "stakeholder_relations_from_id_account_stakeholders_id_fk" FOREIGN KEY ("from_id") REFERENCES "public"."account_stakeholders"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "stakeholder_relations" ADD CONSTRAINT "stakeholder_relations_to_id_account_stakeholders_id_fk" FOREIGN KEY ("to_id") REFERENCES "public"."account_stakeholders"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "stakeholder_relations" ADD CONSTRAINT "stakeholder_relations_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "abm_settings_uq" ON "abm_settings" USING btree ("tenant_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "account_stakeholders_uq" ON "account_stakeholders" USING btree ("contact_id","person_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "account_stakeholders_idx" ON "account_stakeholders" USING btree ("tenant_id","contact_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "influence_change_requests_idx" ON "influence_change_requests" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "influence_change_requests_open_uq" ON "influence_change_requests" USING btree ("stakeholder_id","context_type","context_key") WHERE status = 'pendente';--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "people_name_idx" ON "people" USING btree ("tenant_id","name");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "people_email_idx" ON "people" USING btree ("tenant_id","email");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "stakeholder_events_idx" ON "stakeholder_events" USING btree ("tenant_id","stakeholder_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "stakeholder_influence_uq" ON "stakeholder_influence" USING btree ("stakeholder_id","context_type","context_key");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "stakeholder_influence_history_idx" ON "stakeholder_influence_history" USING btree ("tenant_id","stakeholder_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "stakeholder_relations_idx" ON "stakeholder_relations" USING btree ("tenant_id","contact_id");--> statement-breakpoint
CREATE OR REPLACE FUNCTION isp_forbid_mutation() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE'
     AND TG_TABLE_NAME IN ('opportunity_events', 'activity_events', 'email_messages', 'contract_events', 'contract_versions', 'contract_ledger',
                           'contact_classifications', 'contact_identity_links', 'approval_requests', 'approval_decisions', 'negotiation_messages',
                           'arp_rule_sets', 'arp_item_changes', 'arp_ledger', 'arp_documents', 'arp_events',
                           'cs_assessments', 'cs_presentations', 'cs_surveys', 'project_events',
                           'activity_comments', 'activity_time_entries',
                           'business_events', 'business_event_credits', 'business_event_reviews', 'performance_settings',
                           'indicator_versions', 'scorecard_versions', 'goal_events', 'goal_checkins', 'goal_results', 'org_events', 'result_closings', 'abm_events', 'intervention_events', 'governance_events', 'stakeholder_influence_history', 'stakeholder_events', 'abm_settings')
     AND current_setting('isp.allow_purge', true) = 'on' THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'Tabela % é append-only (operação % bloqueada)', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'check_violation';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER stakeholder_influence_history_append_only BEFORE UPDATE OR DELETE ON "stakeholder_influence_history" FOR EACH ROW EXECUTE FUNCTION isp_forbid_mutation();
--> statement-breakpoint
CREATE TRIGGER stakeholder_events_append_only BEFORE UPDATE OR DELETE ON "stakeholder_events" FOR EACH ROW EXECUTE FUNCTION isp_forbid_mutation();
--> statement-breakpoint
CREATE TRIGGER abm_settings_append_only BEFORE UPDATE OR DELETE ON "abm_settings" FOR EACH ROW EXECUTE FUNCTION isp_forbid_mutation();