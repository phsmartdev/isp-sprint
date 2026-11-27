CREATE TABLE IF NOT EXISTS "work_sprint_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"sprint_id" uuid NOT NULL,
	"activity_id" uuid NOT NULL,
	"status" text DEFAULT 'pendente' NOT NULL,
	"origin" text NOT NULL,
	"justification" text NOT NULL,
	"urgency" text NOT NULL,
	"consequence" text NOT NULL,
	"needed_by" date NOT NULL,
	"estimate_minutes" integer NOT NULL,
	"owner_id" uuid NOT NULL,
	"requested_by" uuid NOT NULL,
	"selection" jsonb,
	"fingerprint" text,
	"analysis" jsonb,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"decision_reason" text,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"approval_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "work_sprint_requests_status_ck" CHECK (status in ('pendente','ajustes','aguardando_gerencia','aprovada','rejeitada','mantida_backlog','cancelada'))
);
--> statement-breakpoint
ALTER TABLE "work_sprint_items" ADD COLUMN "request_id" uuid;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "work_sprint_requests" ADD CONSTRAINT "work_sprint_requests_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "work_sprint_requests" ADD CONSTRAINT "work_sprint_requests_sprint_id_work_sprints_id_fk" FOREIGN KEY ("sprint_id") REFERENCES "public"."work_sprints"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "work_sprint_requests" ADD CONSTRAINT "work_sprint_requests_activity_id_activities_id_fk" FOREIGN KEY ("activity_id") REFERENCES "public"."activities"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "work_sprint_requests" ADD CONSTRAINT "work_sprint_requests_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "work_sprint_requests" ADD CONSTRAINT "work_sprint_requests_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "work_sprint_requests" ADD CONSTRAINT "work_sprint_requests_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "work_sprint_requests" ADD CONSTRAINT "work_sprint_requests_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "work_sprint_requests_idx" ON "work_sprint_requests" USING btree ("tenant_id","sprint_id","status");