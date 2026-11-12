CREATE TABLE IF NOT EXISTS "project_template_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"template_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"status" text DEFAULT 'rascunho' NOT NULL,
	"def" jsonb NOT NULL,
	"notes" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"submitted_at" timestamp with time zone,
	"submitted_by" uuid,
	"published_at" timestamp with time zone,
	"published_by" uuid,
	"review_note" text,
	"row_version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "project_template_versions_status_ck" CHECK (status in ('rascunho','em_aprovacao','publicado','arquivado'))
);
--> statement-breakpoint
ALTER TABLE "projects" DROP CONSTRAINT "projects_kind_ck";--> statement-breakpoint
ALTER TABLE "activities" ADD COLUMN "spec" jsonb;--> statement-breakpoint
ALTER TABLE "project_templates" ADD COLUMN "key" text;--> statement-breakpoint
ALTER TABLE "project_templates" ADD COLUMN "published_version" integer;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "template_id" uuid;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "template_version" integer;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "origin" text DEFAULT 'manual' NOT NULL;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "attention" text;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "project_template_versions" ADD CONSTRAINT "project_template_versions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "project_template_versions" ADD CONSTRAINT "project_template_versions_template_id_project_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."project_templates"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "project_template_versions" ADD CONSTRAINT "project_template_versions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "project_template_versions" ADD CONSTRAINT "project_template_versions_submitted_by_users_id_fk" FOREIGN KEY ("submitted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "project_template_versions" ADD CONSTRAINT "project_template_versions_published_by_users_id_fk" FOREIGN KEY ("published_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "project_template_versions_uq" ON "project_template_versions" USING btree ("template_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "projects_auto_opp_uq" ON "projects" USING btree ("opportunity_id") WHERE origin = 'auto' and deleted_at is null;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_kind_ck" CHECK (kind in ('implantacao','comercial','sucesso_cliente','interno','contrato_publico','licitacao','outro'));