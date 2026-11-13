CREATE TABLE IF NOT EXISTS "budget_closings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"month" text NOT NULL,
	"status" text DEFAULT 'aberto' NOT NULL,
	"snapshot" jsonb,
	"submitted_by" uuid,
	"submitted_at" timestamp with time zone,
	"closed_by" uuid,
	"closed_at" timestamp with time zone,
	"reopened_by" uuid,
	"reopened_at" timestamp with time zone,
	"reopen_reason" text,
	"row_version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "budget_closings_status_ck" CHECK (status in ('aberto','em_conferencia','aguardando_validacao','fechado','reaberto'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "budget_report_dispatches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"closing_id" uuid NOT NULL,
	"month" text NOT NULL,
	"user_id" uuid NOT NULL,
	"email" text NOT NULL,
	"role" text NOT NULL,
	"cost_center_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"subject" text NOT NULL,
	"html" text NOT NULL,
	"status" text DEFAULT 'aguardando_aprovacao' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"sent_at" timestamp with time zone,
	"email_message_id" uuid,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "budget_report_dispatches_status_ck" CHECK (status in ('aguardando_aprovacao','aprovado','enviado','falhou','cancelado')),
	CONSTRAINT "budget_report_dispatches_role_ck" CHECK (role in ('responsavel','gestor','diretoria','financeiro'))
);
--> statement-breakpoint
ALTER TABLE "budget_policies" ADD COLUMN "report_auto_send" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "budget_policies" ADD COLUMN "report_require_approval" boolean DEFAULT true NOT NULL;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "budget_closings" ADD CONSTRAINT "budget_closings_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "budget_closings" ADD CONSTRAINT "budget_closings_submitted_by_users_id_fk" FOREIGN KEY ("submitted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "budget_closings" ADD CONSTRAINT "budget_closings_closed_by_users_id_fk" FOREIGN KEY ("closed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "budget_closings" ADD CONSTRAINT "budget_closings_reopened_by_users_id_fk" FOREIGN KEY ("reopened_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "budget_report_dispatches" ADD CONSTRAINT "budget_report_dispatches_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "budget_report_dispatches" ADD CONSTRAINT "budget_report_dispatches_closing_id_budget_closings_id_fk" FOREIGN KEY ("closing_id") REFERENCES "public"."budget_closings"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "budget_report_dispatches" ADD CONSTRAINT "budget_report_dispatches_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "budget_report_dispatches" ADD CONSTRAINT "budget_report_dispatches_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "budget_report_dispatches" ADD CONSTRAINT "budget_report_dispatches_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "budget_closings_uq" ON "budget_closings" USING btree ("tenant_id","month");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "budget_report_dispatches_idx" ON "budget_report_dispatches" USING btree ("tenant_id","month");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "budget_report_dispatches_uq" ON "budget_report_dispatches" USING btree ("closing_id","user_id","created_at");