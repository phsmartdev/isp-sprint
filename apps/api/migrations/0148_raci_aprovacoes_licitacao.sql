CREATE TABLE IF NOT EXISTS "bid_approval_rules" (
	"tenant_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"approver_id" uuid NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bid_approval_rules_tenant_id_kind_pk" PRIMARY KEY("tenant_id","kind")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "bid_approvals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"opportunity_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"version" integer NOT NULL,
	"status" text DEFAULT 'aguardando' NOT NULL,
	"title" text NOT NULL,
	"justification" text,
	"snapshot" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"requested_by" uuid NOT NULL,
	"approver_id" uuid NOT NULL,
	"decision" text,
	"decision_note" text,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"task_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bid_approvals_status_ck" CHECK (status in ('em_elaboracao','aguardando','aprovado','devolvido','rejeitado','cancelado')),
	CONSTRAINT "bid_approvals_kind_ck" CHECK (kind in ('plano','go_no_go','proposta','alteracao_critica','contratacao'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "bid_area_members" (
	"tenant_id" uuid NOT NULL,
	"area" text NOT NULL,
	"user_id" uuid NOT NULL,
	"role" text DEFAULT 'titular' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bid_area_members_tenant_id_area_user_id_pk" PRIMARY KEY("tenant_id","area","user_id"),
	CONSTRAINT "bid_area_members_role_ck" CHECK (role in ('titular','substituto','gestor'))
);
--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "plan_status" text DEFAULT 'em_elaboracao' NOT NULL;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "go_decision" text;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "bid_approval_rules" ADD CONSTRAINT "bid_approval_rules_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "bid_approval_rules" ADD CONSTRAINT "bid_approval_rules_approver_id_users_id_fk" FOREIGN KEY ("approver_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "bid_approval_rules" ADD CONSTRAINT "bid_approval_rules_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "bid_approvals" ADD CONSTRAINT "bid_approvals_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "bid_approvals" ADD CONSTRAINT "bid_approvals_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "bid_approvals" ADD CONSTRAINT "bid_approvals_opportunity_id_opportunities_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."opportunities"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "bid_approvals" ADD CONSTRAINT "bid_approvals_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "bid_approvals" ADD CONSTRAINT "bid_approvals_approver_id_users_id_fk" FOREIGN KEY ("approver_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "bid_approvals" ADD CONSTRAINT "bid_approvals_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "bid_area_members" ADD CONSTRAINT "bid_area_members_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "bid_area_members" ADD CONSTRAINT "bid_area_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bid_approvals_project_idx" ON "bid_approvals" USING btree ("tenant_id","project_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "bid_approvals_version_uq" ON "bid_approvals" USING btree ("project_id","kind","version");