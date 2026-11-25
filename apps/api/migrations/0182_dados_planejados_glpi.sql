CREATE TABLE IF NOT EXISTS "glpi_queue_tickets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"glpi_id" integer NOT NULL,
	"entity_id" integer,
	"entity_name" text,
	"title" text NOT NULL,
	"category_name" text,
	"requester_name" text,
	"status" integer,
	"status_name" text,
	"priority" integer,
	"opened_at" timestamp with time zone NOT NULL,
	"due_solve_at" timestamp with time zone,
	"due_own_at" timestamp with time zone,
	"taken_at" timestamp with time zone,
	"solved_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"group_ids" integer[] DEFAULT '{}'::int[] NOT NULL,
	"group_names" text[] DEFAULT '{}'::text[] NOT NULL,
	"glpi_user_ids" integer[] DEFAULT '{}'::int[] NOT NULL,
	"glpi_user_names" text[] DEFAULT '{}'::text[] NOT NULL,
	"user_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"glpi_updated_at" text,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_sync_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "glpi_sla_alerts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"ticket_id" uuid,
	"alert_key" text NOT NULL,
	"stage" text NOT NULL,
	"user_id" uuid NOT NULL,
	"channel" text NOT NULL,
	"ok" boolean NOT NULL,
	"error" text,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "glpi_sla_settings" (
	"tenant_id" uuid PRIMARY KEY NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"group_leaders" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"manager_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"root_entity_id" integer DEFAULT 0 NOT NULL,
	"last_sync_at" timestamp with time zone,
	"last_run_at" timestamp with time zone,
	"last_error" text,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "glpi_user_id" integer;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "glpi_user_name" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "glpi_group_ids" integer[] DEFAULT '{}'::int[] NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "glpi_group_names" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "glpi_queue_tickets" ADD CONSTRAINT "glpi_queue_tickets_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "glpi_sla_alerts" ADD CONSTRAINT "glpi_sla_alerts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "glpi_sla_alerts" ADD CONSTRAINT "glpi_sla_alerts_ticket_id_glpi_queue_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."glpi_queue_tickets"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "glpi_sla_alerts" ADD CONSTRAINT "glpi_sla_alerts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "glpi_sla_settings" ADD CONSTRAINT "glpi_sla_settings_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "glpi_sla_settings" ADD CONSTRAINT "glpi_sla_settings_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "glpi_queue_tickets_uq" ON "glpi_queue_tickets" USING btree ("tenant_id","glpi_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "glpi_queue_tickets_open_idx" ON "glpi_queue_tickets" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "glpi_queue_tickets_opened_idx" ON "glpi_queue_tickets" USING btree ("tenant_id","opened_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "glpi_sla_alerts_uq" ON "glpi_sla_alerts" USING btree ("tenant_id","alert_key","user_id","channel");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "glpi_sla_alerts_ticket_idx" ON "glpi_sla_alerts" USING btree ("ticket_id");