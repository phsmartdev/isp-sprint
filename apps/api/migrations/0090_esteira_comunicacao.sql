CREATE TABLE IF NOT EXISTS "comm_flows" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"graph" jsonb NOT NULL,
	"published_graph" jsonb,
	"version" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT false NOT NULL,
	"published_at" timestamp with time zone,
	"published_by" uuid,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"row_version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "comm_run_steps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"node_id" text NOT NULL,
	"node_type" text NOT NULL,
	"label" text NOT NULL,
	"status" text DEFAULT 'agendado' NOT NULL,
	"due_on" date NOT NULL,
	"preview" jsonb,
	"approver_role" text,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"decision_note" text,
	"result" jsonb,
	"notification_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"done_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "comm_run_steps_status_ck" CHECK (status in ('agendado','aguardando_aprovacao','enviado','rejeitado','concluido','falhou','cancelado'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "comm_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"flow_id" uuid NOT NULL,
	"flow_version" integer NOT NULL,
	"contract_id" uuid NOT NULL,
	"anchor_date" date NOT NULL,
	"status" text DEFAULT 'ativo' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	CONSTRAINT "comm_runs_status_ck" CHECK (status in ('ativo','concluido','cancelado'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "comm_template_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"template_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"channels" text[] NOT NULL,
	"subject" text NOT NULL,
	"body" text NOT NULL,
	"whatsapp" text NOT NULL,
	"published_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "comm_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"channels" text[] DEFAULT '{}'::text[] NOT NULL,
	"subject" text DEFAULT '' NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"whatsapp" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'rascunho' NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"row_version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "comm_templates_status_ck" CHECK (status in ('rascunho','publicado','arquivado'))
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "comm_flows" ADD CONSTRAINT "comm_flows_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "comm_flows" ADD CONSTRAINT "comm_flows_published_by_users_id_fk" FOREIGN KEY ("published_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "comm_flows" ADD CONSTRAINT "comm_flows_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "comm_run_steps" ADD CONSTRAINT "comm_run_steps_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "comm_run_steps" ADD CONSTRAINT "comm_run_steps_run_id_comm_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."comm_runs"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "comm_run_steps" ADD CONSTRAINT "comm_run_steps_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "comm_runs" ADD CONSTRAINT "comm_runs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "comm_runs" ADD CONSTRAINT "comm_runs_flow_id_comm_flows_id_fk" FOREIGN KEY ("flow_id") REFERENCES "public"."comm_flows"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "comm_runs" ADD CONSTRAINT "comm_runs_contract_id_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."contracts"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "comm_template_versions" ADD CONSTRAINT "comm_template_versions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "comm_template_versions" ADD CONSTRAINT "comm_template_versions_template_id_comm_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."comm_templates"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "comm_template_versions" ADD CONSTRAINT "comm_template_versions_published_by_users_id_fk" FOREIGN KEY ("published_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "comm_templates" ADD CONSTRAINT "comm_templates_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "comm_templates" ADD CONSTRAINT "comm_templates_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "comm_flows_idx" ON "comm_flows" USING btree ("tenant_id","active");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "comm_run_steps_run_idx" ON "comm_run_steps" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "comm_run_steps_pend_idx" ON "comm_run_steps" USING btree ("tenant_id","status","due_on");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "comm_runs_uq" ON "comm_runs" USING btree ("flow_id","contract_id","anchor_date");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "comm_runs_ctr_idx" ON "comm_runs" USING btree ("tenant_id","contract_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "comm_template_versions_uq" ON "comm_template_versions" USING btree ("template_id","version");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "comm_templates_idx" ON "comm_templates" USING btree ("tenant_id");