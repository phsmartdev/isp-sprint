CREATE TABLE IF NOT EXISTS "import_connectors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"secrets" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'nao_testado' NOT NULL,
	"last_test_at" timestamp with time zone,
	"last_test_result" text,
	"archived_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "import_connectors_kind_ck" CHECK (kind in ('rdstation_crm','csv')),
	CONSTRAINT "import_connectors_status_ck" CHECK (status in ('nao_testado','ok','falhou'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "import_fetch_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"seq" serial NOT NULL,
	"job" jsonb NOT NULL,
	"dedupe_key" text NOT NULL,
	"status" text DEFAULT 'pendente' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"not_before" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "import_fetch_jobs_status_ck" CHECK (status in ('pendente','feito','falhou'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "import_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"source" text NOT NULL,
	"source_entity" text NOT NULL,
	"source_id" text NOT NULL,
	"target_entity" text NOT NULL,
	"target_id" uuid NOT NULL,
	"first_run_id" uuid NOT NULL,
	"last_run_id" uuid NOT NULL,
	"last_written_at" timestamp with time zone NOT NULL,
	"legacy" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "import_raw_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"seq" serial NOT NULL,
	"entity" text NOT NULL,
	"source_id" text NOT NULL,
	"payload" jsonb NOT NULL,
	"reason" text DEFAULT 'selecionado' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "import_record_results" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"raw_id" uuid NOT NULL,
	"source_entity" text NOT NULL,
	"source_id" text NOT NULL,
	"target_entity" text NOT NULL,
	"action" text NOT NULL,
	"target_id" uuid,
	"values" jsonb NOT NULL,
	"originals" jsonb NOT NULL,
	"converted" text[] DEFAULT '{}'::text[] NOT NULL,
	"issues" jsonb NOT NULL,
	"legacy" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"reason" text,
	"duplicate" boolean DEFAULT false NOT NULL,
	"decision" text,
	"decided_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "import_record_results_action_ck" CHECK (action in ('criar','atualizar','ignorar','revisar','erro'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "import_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"code" serial NOT NULL,
	"mode" text NOT NULL,
	"template_id" uuid,
	"template_version_id" uuid,
	"temporary_changes" boolean DEFAULT false NOT NULL,
	"config_snapshot" jsonb NOT NULL,
	"config_hash" text NOT NULL,
	"connector_id" uuid NOT NULL,
	"source" text NOT NULL,
	"scope" jsonb NOT NULL,
	"scope_hash" text NOT NULL,
	"simulation_run_id" uuid,
	"status" text DEFAULT 'na_fila' NOT NULL,
	"phase" text DEFAULT 'extracao' NOT NULL,
	"counters" jsonb NOT NULL,
	"checkpoint" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"warnings" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"error" text,
	"started_by" uuid,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"large_volume_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"locked_until" timestamp with time zone,
	CONSTRAINT "import_runs_mode_ck" CHECK (mode in ('simulacao','importacao')),
	CONSTRAINT "import_runs_status_ck" CHECK (status in ('na_fila','em_andamento','pausada','cancelada','concluida','concluida_com_pendencias','falhou')),
	CONSTRAINT "import_runs_phase_ck" CHECK (phase in ('extracao','processamento','fim'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "import_source_files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"connector_id" uuid NOT NULL,
	"entity" text NOT NULL,
	"name" text NOT NULL,
	"id_column" text,
	"content" text NOT NULL,
	"rows" integer NOT NULL,
	"uploaded_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "import_template_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"template_id" uuid NOT NULL,
	"number" text NOT NULL,
	"config" jsonb NOT NULL,
	"justification" text NOT NULL,
	"status" text DEFAULT 'rascunho' NOT NULL,
	"based_on_version_id" uuid,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"locked_at" timestamp with time zone,
	"row_version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "import_template_versions_status_ck" CHECK (status in ('rascunho','aprovada','substituida'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "import_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"source" text NOT NULL,
	"connector_id" uuid,
	"current_version_id" uuid,
	"archived_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "import_connectors" ADD CONSTRAINT "import_connectors_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "import_connectors" ADD CONSTRAINT "import_connectors_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "import_fetch_jobs" ADD CONSTRAINT "import_fetch_jobs_run_id_import_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."import_runs"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "import_links" ADD CONSTRAINT "import_links_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "import_links" ADD CONSTRAINT "import_links_first_run_id_import_runs_id_fk" FOREIGN KEY ("first_run_id") REFERENCES "public"."import_runs"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "import_links" ADD CONSTRAINT "import_links_last_run_id_import_runs_id_fk" FOREIGN KEY ("last_run_id") REFERENCES "public"."import_runs"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "import_raw_records" ADD CONSTRAINT "import_raw_records_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "import_raw_records" ADD CONSTRAINT "import_raw_records_run_id_import_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."import_runs"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "import_record_results" ADD CONSTRAINT "import_record_results_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "import_record_results" ADD CONSTRAINT "import_record_results_run_id_import_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."import_runs"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "import_record_results" ADD CONSTRAINT "import_record_results_raw_id_import_raw_records_id_fk" FOREIGN KEY ("raw_id") REFERENCES "public"."import_raw_records"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "import_record_results" ADD CONSTRAINT "import_record_results_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "import_runs" ADD CONSTRAINT "import_runs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "import_runs" ADD CONSTRAINT "import_runs_template_id_import_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."import_templates"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "import_runs" ADD CONSTRAINT "import_runs_template_version_id_import_template_versions_id_fk" FOREIGN KEY ("template_version_id") REFERENCES "public"."import_template_versions"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "import_runs" ADD CONSTRAINT "import_runs_connector_id_import_connectors_id_fk" FOREIGN KEY ("connector_id") REFERENCES "public"."import_connectors"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "import_runs" ADD CONSTRAINT "import_runs_started_by_users_id_fk" FOREIGN KEY ("started_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "import_runs" ADD CONSTRAINT "import_runs_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "import_runs" ADD CONSTRAINT "import_runs_large_volume_by_users_id_fk" FOREIGN KEY ("large_volume_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "import_source_files" ADD CONSTRAINT "import_source_files_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "import_source_files" ADD CONSTRAINT "import_source_files_connector_id_import_connectors_id_fk" FOREIGN KEY ("connector_id") REFERENCES "public"."import_connectors"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "import_source_files" ADD CONSTRAINT "import_source_files_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "import_template_versions" ADD CONSTRAINT "import_template_versions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "import_template_versions" ADD CONSTRAINT "import_template_versions_template_id_import_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."import_templates"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "import_template_versions" ADD CONSTRAINT "import_template_versions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "import_template_versions" ADD CONSTRAINT "import_template_versions_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "import_templates" ADD CONSTRAINT "import_templates_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "import_templates" ADD CONSTRAINT "import_templates_connector_id_import_connectors_id_fk" FOREIGN KEY ("connector_id") REFERENCES "public"."import_connectors"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "import_templates" ADD CONSTRAINT "import_templates_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "import_connectors_name_uq" ON "import_connectors" USING btree ("tenant_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "import_fetch_jobs_uq" ON "import_fetch_jobs" USING btree ("run_id","dedupe_key");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "import_fetch_jobs_pend_idx" ON "import_fetch_jobs" USING btree ("run_id","status","seq");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "import_links_uq" ON "import_links" USING btree ("tenant_id","source","target_entity","source_entity","source_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "import_links_target_idx" ON "import_links" USING btree ("tenant_id","target_entity","target_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "import_raw_records_uq" ON "import_raw_records" USING btree ("run_id","entity","source_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "import_raw_records_seq_idx" ON "import_raw_records" USING btree ("run_id","seq");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "import_record_results_uq" ON "import_record_results" USING btree ("run_id","target_entity","source_entity","source_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "import_record_results_run_idx" ON "import_record_results" USING btree ("run_id","action");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "import_runs_tenant_idx" ON "import_runs" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "import_source_files_uq" ON "import_source_files" USING btree ("connector_id","entity");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "import_template_versions_uq" ON "import_template_versions" USING btree ("template_id","number");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "import_templates_name_uq" ON "import_templates" USING btree ("tenant_id","name");