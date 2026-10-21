CREATE TABLE IF NOT EXISTS "activity_comments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"activity_id" uuid NOT NULL,
	"author_id" uuid,
	"body" text NOT NULL,
	"mentions" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "activity_dependencies" (
	"tenant_id" uuid NOT NULL,
	"activity_id" uuid NOT NULL,
	"depends_on_id" uuid NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "activity_dependencies_activity_id_depends_on_id_pk" PRIMARY KEY("activity_id","depends_on_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "activity_reads" (
	"user_id" uuid NOT NULL,
	"activity_id" uuid NOT NULL,
	"last_read_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "activity_reads_user_id_activity_id_pk" PRIMARY KEY("user_id","activity_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "activity_time_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"activity_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"minutes" integer NOT NULL,
	"worked_on" date NOT NULL,
	"note" text,
	"reverses_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "task_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"title" text NOT NULL,
	"notes" text,
	"priority" text DEFAULT 'media' NOT NULL,
	"checklist" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"estimate_minutes" integer,
	"tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"category" text,
	"requires_approval" boolean DEFAULT false NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "work_files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"activity_id" uuid,
	"project_id" uuid,
	"name" text NOT NULL,
	"mime" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"data" "bytea" NOT NULL,
	"uploaded_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"deleted_by" uuid
);
--> statement-breakpoint
ALTER TABLE "activities" ADD COLUMN "status" text DEFAULT 'a_fazer' NOT NULL;--> statement-breakpoint
ALTER TABLE "activities" ADD COLUMN "parent_id" uuid;--> statement-breakpoint
ALTER TABLE "activities" ADD COLUMN "checklist" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "activities" ADD COLUMN "estimate_minutes" integer;--> statement-breakpoint
ALTER TABLE "activities" ADD COLUMN "tags" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "activities" ADD COLUMN "category" text;--> statement-breakpoint
ALTER TABLE "activities" ADD COLUMN "participants" uuid[] DEFAULT '{}'::uuid[] NOT NULL;--> statement-breakpoint
ALTER TABLE "activities" ADD COLUMN "waiting_on" text;--> statement-breakpoint
ALTER TABLE "activities" ADD COLUMN "recurrence" jsonb;--> statement-breakpoint
ALTER TABLE "activities" ADD COLUMN "series_id" uuid;--> statement-breakpoint
ALTER TABLE "activities" ADD COLUMN "recurrence_key" text;--> statement-breakpoint
ALTER TABLE "activities" ADD COLUMN "requires_approval" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "activities" ADD COLUMN "approver_id" uuid;--> statement-breakpoint
ALTER TABLE "activities" ADD COLUMN "approved_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "activities" ADD COLUMN "approved_by" uuid;--> statement-breakpoint
ALTER TABLE "activities" ADD COLUMN "arp_id" uuid;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "campaign_id" uuid;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "objective" text;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "category" text;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "tags" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "activity_comments" ADD CONSTRAINT "activity_comments_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "activity_comments" ADD CONSTRAINT "activity_comments_activity_id_activities_id_fk" FOREIGN KEY ("activity_id") REFERENCES "public"."activities"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "activity_comments" ADD CONSTRAINT "activity_comments_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "activity_dependencies" ADD CONSTRAINT "activity_dependencies_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "activity_dependencies" ADD CONSTRAINT "activity_dependencies_activity_id_activities_id_fk" FOREIGN KEY ("activity_id") REFERENCES "public"."activities"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "activity_dependencies" ADD CONSTRAINT "activity_dependencies_depends_on_id_activities_id_fk" FOREIGN KEY ("depends_on_id") REFERENCES "public"."activities"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "activity_dependencies" ADD CONSTRAINT "activity_dependencies_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "activity_reads" ADD CONSTRAINT "activity_reads_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "activity_reads" ADD CONSTRAINT "activity_reads_activity_id_activities_id_fk" FOREIGN KEY ("activity_id") REFERENCES "public"."activities"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "activity_time_entries" ADD CONSTRAINT "activity_time_entries_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "activity_time_entries" ADD CONSTRAINT "activity_time_entries_activity_id_activities_id_fk" FOREIGN KEY ("activity_id") REFERENCES "public"."activities"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "activity_time_entries" ADD CONSTRAINT "activity_time_entries_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "task_templates" ADD CONSTRAINT "task_templates_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "task_templates" ADD CONSTRAINT "task_templates_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "work_files" ADD CONSTRAINT "work_files_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "work_files" ADD CONSTRAINT "work_files_activity_id_activities_id_fk" FOREIGN KEY ("activity_id") REFERENCES "public"."activities"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "work_files" ADD CONSTRAINT "work_files_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "activity_comments_idx" ON "activity_comments" USING btree ("tenant_id","activity_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "activity_deps_rev_idx" ON "activity_dependencies" USING btree ("depends_on_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "activity_time_idx" ON "activity_time_entries" USING btree ("tenant_id","activity_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "activity_time_user_idx" ON "activity_time_entries" USING btree ("tenant_id","user_id","worked_on");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "task_templates_idx" ON "task_templates" USING btree ("tenant_id","active");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "work_files_act_idx" ON "work_files" USING btree ("tenant_id","activity_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "work_files_proj_idx" ON "work_files" USING btree ("tenant_id","project_id");--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "activities" ADD CONSTRAINT "activities_parent_id_activities_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."activities"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "activities" ADD CONSTRAINT "activities_approver_id_users_id_fk" FOREIGN KEY ("approver_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "activities" ADD CONSTRAINT "activities_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "activities_parent_idx" ON "activities" USING btree ("tenant_id","parent_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "activities_recurrence_uq" ON "activities" USING btree ("tenant_id","recurrence_key") WHERE recurrence_key is not null;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "activities_links_idx" ON "activities" USING btree ("tenant_id","contract_id","arp_id");--> statement-breakpoint
ALTER TABLE "activities" ADD CONSTRAINT "activities_status_ck" CHECK (status in ('a_fazer','em_andamento','aguardando','em_aprovacao','concluida','cancelada'));--> statement-breakpoint
UPDATE "activities" SET "status" = 'concluida' WHERE "completed_at" IS NOT NULL AND "status" <> 'concluida';
--> statement-breakpoint
CREATE OR REPLACE FUNCTION isp_forbid_mutation() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE'
     AND TG_TABLE_NAME IN ('opportunity_events', 'activity_events', 'email_messages', 'contract_events', 'contract_versions', 'contract_ledger',
                           'contact_classifications', 'contact_identity_links', 'approval_requests', 'approval_decisions', 'negotiation_messages',
                           'arp_rule_sets', 'arp_item_changes', 'arp_ledger', 'arp_documents', 'arp_events',
                           'cs_assessments', 'cs_presentations', 'cs_surveys', 'project_events',
                           'activity_comments', 'activity_time_entries')
     AND current_setting('isp.allow_purge', true) = 'on' THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'Tabela % é append-only (operação % bloqueada)', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'check_violation';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER activity_comments_append_only BEFORE UPDATE OR DELETE ON "activity_comments" FOR EACH ROW EXECUTE FUNCTION isp_forbid_mutation();
--> statement-breakpoint
CREATE TRIGGER activity_time_entries_append_only BEFORE UPDATE OR DELETE ON "activity_time_entries" FOR EACH ROW EXECUTE FUNCTION isp_forbid_mutation();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION isp_activity_status_sync() RETURNS trigger AS $$
BEGIN
  -- concluída ⇔ completed_at preenchido, qualquer que seja o caminho que gravou
  IF NEW.completed_at IS NOT NULL AND NEW.status <> 'concluida' THEN
    NEW.status := 'concluida';
  ELSIF NEW.completed_at IS NULL AND NEW.status = 'concluida' THEN
    NEW.status := 'a_fazer';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER activities_status_sync BEFORE INSERT OR UPDATE OF completed_at, status ON "activities" FOR EACH ROW EXECUTE FUNCTION isp_activity_status_sync();
