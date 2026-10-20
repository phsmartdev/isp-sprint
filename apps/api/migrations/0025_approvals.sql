CREATE TABLE IF NOT EXISTS "approval_decisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"request_id" uuid NOT NULL,
	"opportunity_id" uuid NOT NULL,
	"decision" text NOT NULL,
	"decided_by" uuid,
	"level" text,
	"comment" text,
	"financial_summary" jsonb,
	"data_version" jsonb,
	"material_changes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"approved_conditions" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "approval_decisions_decision_ck" CHECK (decision in ('aprovada','reprovada','correcao','substituida'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "approval_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"opportunity_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"requested_by" uuid NOT NULL,
	"negotiation_type" text NOT NULL,
	"list_monthly_cents" bigint,
	"proposed_monthly_cents" bigint NOT NULL,
	"discount_bp" integer DEFAULT 0 NOT NULL,
	"activation_fee_cents" bigint,
	"replaces_monthly_cents" bigint DEFAULT 0 NOT NULL,
	"term_months" integer,
	"conditions" text,
	"justification" text NOT NULL,
	"risks" text,
	"proposal_attachment_id" uuid,
	"proposal_sha256" text,
	"required_level" text NOT NULL,
	"exceptional" boolean DEFAULT false NOT NULL,
	"snapshot" jsonb NOT NULL,
	"fingerprint" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "approval_requests_level_ck" CHECK (required_level in ('supervisor','gerencia','diretoria'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "approval_settings" (
	"tenant_id" uuid PRIMARY KEY NOT NULL,
	"policy" jsonb,
	"classification_options" jsonb,
	"notify_email" boolean DEFAULT true NOT NULL,
	"notify_whatsapp" boolean DEFAULT false NOT NULL,
	"notify_show_class" boolean DEFAULT false NOT NULL,
	"template" text,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "contact_classifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"contact_id" uuid NOT NULL,
	"class_key" text,
	"category" text,
	"profile" text,
	"payer_profile" text,
	"potential" text,
	"risk" text,
	"notes" text,
	"classified_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "contact_identity_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"contact_id" uuid NOT NULL,
	"other_contact_id" uuid NOT NULL,
	"decision" text NOT NULL,
	"note" text,
	"decided_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "contact_identity_links_decision_ck" CHECK (decision in ('mesmo','diferente'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "negotiation_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"opportunity_id" uuid NOT NULL,
	"author_id" uuid,
	"kind" text DEFAULT 'mensagem' NOT NULL,
	"body" text NOT NULL,
	"request_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "negotiation_messages_kind_ck" CHECK (kind in ('mensagem','sistema'))
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "phone" text;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "approval_decisions" ADD CONSTRAINT "approval_decisions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "approval_decisions" ADD CONSTRAINT "approval_decisions_request_id_approval_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."approval_requests"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "approval_decisions" ADD CONSTRAINT "approval_decisions_opportunity_id_opportunities_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."opportunities"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "approval_decisions" ADD CONSTRAINT "approval_decisions_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_opportunity_id_opportunities_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."opportunities"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "approval_settings" ADD CONSTRAINT "approval_settings_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "approval_settings" ADD CONSTRAINT "approval_settings_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "contact_classifications" ADD CONSTRAINT "contact_classifications_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "contact_classifications" ADD CONSTRAINT "contact_classifications_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "contact_classifications" ADD CONSTRAINT "contact_classifications_classified_by_users_id_fk" FOREIGN KEY ("classified_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "contact_identity_links" ADD CONSTRAINT "contact_identity_links_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "contact_identity_links" ADD CONSTRAINT "contact_identity_links_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "contact_identity_links" ADD CONSTRAINT "contact_identity_links_other_contact_id_contacts_id_fk" FOREIGN KEY ("other_contact_id") REFERENCES "public"."contacts"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "contact_identity_links" ADD CONSTRAINT "contact_identity_links_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "negotiation_messages" ADD CONSTRAINT "negotiation_messages_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "negotiation_messages" ADD CONSTRAINT "negotiation_messages_opportunity_id_opportunities_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."opportunities"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "negotiation_messages" ADD CONSTRAINT "negotiation_messages_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "approval_decisions_uq" ON "approval_decisions" USING btree ("request_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "approval_decisions_opp_idx" ON "approval_decisions" USING btree ("tenant_id","opportunity_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "approval_requests_uq" ON "approval_requests" USING btree ("opportunity_id","version");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "approval_requests_tenant_idx" ON "approval_requests" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "contact_classifications_idx" ON "contact_classifications" USING btree ("tenant_id","contact_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "contact_identity_links_idx" ON "contact_identity_links" USING btree ("tenant_id","contact_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "negotiation_messages_idx" ON "negotiation_messages" USING btree ("tenant_id","opportunity_id","created_at");--> statement-breakpoint
CREATE OR REPLACE FUNCTION isp_forbid_mutation() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE'
     AND TG_TABLE_NAME IN ('opportunity_events', 'activity_events', 'email_messages', 'contract_events', 'contract_versions', 'contract_ledger',
                           'contact_classifications', 'contact_identity_links', 'approval_requests', 'approval_decisions', 'negotiation_messages')
     AND current_setting('isp.allow_purge', true) = 'on' THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'Tabela % é append-only (operação % bloqueada)', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'check_violation';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER contact_classifications_append_only BEFORE UPDATE OR DELETE ON "contact_classifications" FOR EACH ROW EXECUTE FUNCTION isp_forbid_mutation();
--> statement-breakpoint
CREATE TRIGGER contact_identity_links_append_only BEFORE UPDATE OR DELETE ON "contact_identity_links" FOR EACH ROW EXECUTE FUNCTION isp_forbid_mutation();
--> statement-breakpoint
CREATE TRIGGER approval_requests_append_only BEFORE UPDATE OR DELETE ON "approval_requests" FOR EACH ROW EXECUTE FUNCTION isp_forbid_mutation();
--> statement-breakpoint
CREATE TRIGGER approval_decisions_append_only BEFORE UPDATE OR DELETE ON "approval_decisions" FOR EACH ROW EXECUTE FUNCTION isp_forbid_mutation();
--> statement-breakpoint
CREATE TRIGGER negotiation_messages_append_only BEFORE UPDATE OR DELETE ON "negotiation_messages" FOR EACH ROW EXECUTE FUNCTION isp_forbid_mutation();
