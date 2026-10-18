CREATE TABLE IF NOT EXISTS "business_instructions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"status" text DEFAULT 'rascunho' NOT NULL,
	"content" jsonb NOT NULL,
	"changes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"notes" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"activated_by" uuid,
	"activated_at" timestamp with time zone,
	CONSTRAINT "business_instructions_status_ck" CHECK (status in ('rascunho','ativa','arquivada'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "email_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"to_address" text NOT NULL,
	"subject" text NOT NULL,
	"status" text NOT NULL,
	"error" text,
	"message_id" text,
	"opportunity_id" uuid,
	"attachment_id" uuid,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "email_messages_status_ck" CHECK (status in ('enviado','falhou','ignorado'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "notification_settings" (
	"tenant_id" uuid PRIMARY KEY NOT NULL,
	"activity_digest" boolean DEFAULT true NOT NULL,
	"lead_assigned" boolean DEFAULT true NOT NULL,
	"deal_won" boolean DEFAULT true NOT NULL,
	"user_access" boolean DEFAULT true NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "opportunity_answers" (
	"tenant_id" uuid NOT NULL,
	"opportunity_id" uuid NOT NULL,
	"question_id" text NOT NULL,
	"answer" text NOT NULL,
	"instruction_version" integer,
	"answered_by" uuid,
	"answered_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "opportunity_answers_opportunity_id_question_id_pk" PRIMARY KEY("opportunity_id","question_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "opportunity_attachments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"opportunity_id" uuid NOT NULL,
	"kind" text DEFAULT 'proposta' NOT NULL,
	"filename" text NOT NULL,
	"mime" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"sha256" text NOT NULL,
	"data" "bytea" NOT NULL,
	"uploaded_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"deleted_by" uuid,
	CONSTRAINT "opp_attach_kind_ck" CHECK (kind in ('proposta','outro'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "pipelines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"segments" text[] DEFAULT '{}'::text[] NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "smtp_settings" (
	"tenant_id" uuid PRIMARY KEY NOT NULL,
	"host" text NOT NULL,
	"port" integer NOT NULL,
	"secure" boolean DEFAULT false NOT NULL,
	"username" text,
	"password_enc" text,
	"from_name" text NOT NULL,
	"from_email" text NOT NULL,
	"reply_to" text,
	"enabled" boolean DEFAULT true NOT NULL,
	"last_test_at" timestamp with time zone,
	"last_test_ok" boolean,
	"last_test_error" text,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "opportunities" DROP CONSTRAINT "opp_stage_ck";--> statement-breakpoint
DROP INDEX IF EXISTS "pipeline_stages_uq";--> statement-breakpoint
ALTER TABLE "opportunities" ADD COLUMN "pipeline_id" uuid;--> statement-breakpoint
ALTER TABLE "pipeline_stages" ADD COLUMN "pipeline_id" uuid;--> statement-breakpoint
-- Backfill: cada empresa existente ganha a jornada padrão "Residencial" com as etapas que já tinha.
INSERT INTO "pipelines" ("tenant_id", "key", "name", "segments", "is_default", "position")
SELECT t.id, 'residencial', 'Residencial', '{residencial}', true, 0 FROM "tenants" t
ON CONFLICT DO NOTHING;--> statement-breakpoint
UPDATE "pipeline_stages" ps SET "pipeline_id" = p.id FROM "pipelines" p WHERE p.tenant_id = ps.tenant_id AND p.key = 'residencial';--> statement-breakpoint
UPDATE "opportunities" o SET "pipeline_id" = p.id FROM "pipelines" p WHERE p.tenant_id = o.tenant_id AND p.key = 'residencial';--> statement-breakpoint
ALTER TABLE "opportunities" ALTER COLUMN "pipeline_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "pipeline_stages" ALTER COLUMN "pipeline_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "pipeline_stages" ADD COLUMN "kind" text DEFAULT 'open' NOT NULL;--> statement-breakpoint
ALTER TABLE "pipeline_stages" ADD COLUMN "color" text;--> statement-breakpoint
ALTER TABLE "pipeline_stages" ADD COLUMN "requirements" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
UPDATE "pipeline_stages" SET "kind" = CASE key WHEN 'ganha' THEN 'won' WHEN 'perdida' THEN 'lost' ELSE 'open' END;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "business_instructions" ADD CONSTRAINT "business_instructions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "business_instructions" ADD CONSTRAINT "business_instructions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "business_instructions" ADD CONSTRAINT "business_instructions_activated_by_users_id_fk" FOREIGN KEY ("activated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "email_messages" ADD CONSTRAINT "email_messages_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "email_messages" ADD CONSTRAINT "email_messages_opportunity_id_opportunities_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."opportunities"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "email_messages" ADD CONSTRAINT "email_messages_attachment_id_opportunity_attachments_id_fk" FOREIGN KEY ("attachment_id") REFERENCES "public"."opportunity_attachments"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "email_messages" ADD CONSTRAINT "email_messages_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "notification_settings" ADD CONSTRAINT "notification_settings_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "notification_settings" ADD CONSTRAINT "notification_settings_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "opportunity_answers" ADD CONSTRAINT "opportunity_answers_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "opportunity_answers" ADD CONSTRAINT "opportunity_answers_opportunity_id_opportunities_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."opportunities"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "opportunity_answers" ADD CONSTRAINT "opportunity_answers_answered_by_users_id_fk" FOREIGN KEY ("answered_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "opportunity_attachments" ADD CONSTRAINT "opportunity_attachments_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "opportunity_attachments" ADD CONSTRAINT "opportunity_attachments_opportunity_id_opportunities_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."opportunities"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "opportunity_attachments" ADD CONSTRAINT "opportunity_attachments_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "opportunity_attachments" ADD CONSTRAINT "opportunity_attachments_deleted_by_users_id_fk" FOREIGN KEY ("deleted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "pipelines" ADD CONSTRAINT "pipelines_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "smtp_settings" ADD CONSTRAINT "smtp_settings_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "smtp_settings" ADD CONSTRAINT "smtp_settings_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "business_instructions_version_uq" ON "business_instructions" USING btree ("tenant_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "business_instructions_active_uq" ON "business_instructions" USING btree ("tenant_id") WHERE status = 'ativa';--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "email_messages_tenant_idx" ON "email_messages" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "opp_attach_opp_idx" ON "opportunity_attachments" USING btree ("tenant_id","opportunity_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "pipelines_uq" ON "pipelines" USING btree ("tenant_id","key");--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_pipeline_id_pipelines_id_fk" FOREIGN KEY ("pipeline_id") REFERENCES "public"."pipelines"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "pipeline_stages" ADD CONSTRAINT "pipeline_stages_pipeline_id_pipelines_id_fk" FOREIGN KEY ("pipeline_id") REFERENCES "public"."pipelines"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "opp_pipeline_idx" ON "opportunities" USING btree ("tenant_id","pipeline_id","stage");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "pipeline_stages_pipe_uq" ON "pipeline_stages" USING btree ("pipeline_id","key");--> statement-breakpoint
ALTER TABLE "pipeline_stages" ADD CONSTRAINT "pipeline_stages_kind_ck" CHECK (kind in ('open','won','lost'));--> statement-breakpoint
-- E-mails enviados são histórico: não se apagam nem se alteram.
CREATE TRIGGER email_messages_append_only BEFORE UPDATE OR DELETE ON "email_messages" FOR EACH ROW EXECUTE FUNCTION isp_forbid_mutation();