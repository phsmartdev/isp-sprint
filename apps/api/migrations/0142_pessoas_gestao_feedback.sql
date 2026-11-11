CREATE TABLE IF NOT EXISTS "dev_policies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"config" jsonb NOT NULL,
	"note" text,
	"effective_from" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "domain_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"type" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"source" text NOT NULL,
	"correlation_id" uuid,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"idem_key" text NOT NULL,
	"status" text DEFAULT 'pendente' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone,
	CONSTRAINT "domain_events_status_ck" CHECK (status in ('pendente','processado','falhou'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "people_feedback_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"feedback_id" uuid NOT NULL,
	"type" text NOT NULL,
	"actor_id" uuid NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "people_feedbacks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"sender_id" uuid NOT NULL,
	"recipient_id" uuid NOT NULL,
	"direction" text NOT NULL,
	"modality" text NOT NULL,
	"mode" text DEFAULT 'identificado' NOT NULL,
	"occurred_on" date NOT NULL,
	"situation" text NOT NULL,
	"behavior" text NOT NULL,
	"impact" text NOT NULL,
	"guidance" text,
	"next_steps" text,
	"competency_id" uuid,
	"status" text DEFAULT 'rascunho' NOT NULL,
	"policy_version" integer DEFAULT 0 NOT NULL,
	"sent_at" timestamp with time zone,
	"acknowledged_at" timestamp with time zone,
	"response" text,
	"responded_at" timestamp with time zone,
	"mediator_id" uuid,
	"synthesis" text,
	"mediation_note" text,
	"mediated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "people_feedbacks_direction_ck" CHECK (direction in ('descendente','ascendente')),
	CONSTRAINT "people_feedbacks_modality_ck" CHECK (modality in ('reconhecimento','orientacao','melhoria','reforco','desenvolvimento','alinhamento')),
	CONSTRAINT "people_feedbacks_mode_ck" CHECK (mode in ('identificado','confidencial')),
	CONSTRAINT "people_feedbacks_status_ck" CHECK (status in ('rascunho','enviado','ciente','em_mediacao','repassado','tratado_sem_repasse'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "reporting_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"manager_id" uuid NOT NULL,
	"source" text NOT NULL,
	"team_id" uuid,
	"org_unit_id" uuid,
	"valid_from" timestamp with time zone DEFAULT now() NOT NULL,
	"valid_to" timestamp with time zone,
	CONSTRAINT "reporting_lines_source_ck" CHECK (source in ('time','gestao'))
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "dev_policies" ADD CONSTRAINT "dev_policies_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "dev_policies" ADD CONSTRAINT "dev_policies_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "domain_events" ADD CONSTRAINT "domain_events_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "people_feedback_events" ADD CONSTRAINT "people_feedback_events_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "people_feedback_events" ADD CONSTRAINT "people_feedback_events_feedback_id_people_feedbacks_id_fk" FOREIGN KEY ("feedback_id") REFERENCES "public"."people_feedbacks"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "people_feedback_events" ADD CONSTRAINT "people_feedback_events_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "people_feedbacks" ADD CONSTRAINT "people_feedbacks_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "people_feedbacks" ADD CONSTRAINT "people_feedbacks_sender_id_users_id_fk" FOREIGN KEY ("sender_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "people_feedbacks" ADD CONSTRAINT "people_feedbacks_recipient_id_users_id_fk" FOREIGN KEY ("recipient_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "people_feedbacks" ADD CONSTRAINT "people_feedbacks_mediator_id_users_id_fk" FOREIGN KEY ("mediator_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "reporting_lines" ADD CONSTRAINT "reporting_lines_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "reporting_lines" ADD CONSTRAINT "reporting_lines_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "reporting_lines" ADD CONSTRAINT "reporting_lines_manager_id_users_id_fk" FOREIGN KEY ("manager_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "dev_policies_uq" ON "dev_policies" USING btree ("tenant_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "domain_events_idem_uq" ON "domain_events" USING btree ("tenant_id","idem_key");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "domain_events_pending_idx" ON "domain_events" USING btree ("status","occurred_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "domain_events_type_idx" ON "domain_events" USING btree ("tenant_id","type","occurred_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "people_feedback_events_idx" ON "people_feedback_events" USING btree ("feedback_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "people_feedbacks_recipient_idx" ON "people_feedbacks" USING btree ("tenant_id","recipient_id","sent_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "people_feedbacks_sender_idx" ON "people_feedbacks" USING btree ("tenant_id","sender_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "people_feedbacks_status_idx" ON "people_feedbacks" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "reporting_lines_open_uq" ON "reporting_lines" USING btree ("tenant_id","user_id","manager_id") WHERE valid_to is null;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "reporting_lines_user_idx" ON "reporting_lines" USING btree ("tenant_id","user_id","valid_from");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "reporting_lines_manager_idx" ON "reporting_lines" USING btree ("tenant_id","manager_id","valid_from");