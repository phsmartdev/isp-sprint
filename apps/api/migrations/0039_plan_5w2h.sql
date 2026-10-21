CREATE TABLE IF NOT EXISTS "intervention_actions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"intervention_id" uuid NOT NULL,
	"activity_id" uuid NOT NULL,
	"what" text NOT NULL,
	"why" text NOT NULL,
	"root_cause" text,
	"where_at" text DEFAULT '' NOT NULL,
	"how" text NOT NULL,
	"how_much_cents" bigint,
	"cancel_reason" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "interventions" ADD COLUMN "project_id" uuid;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "intervention_actions" ADD CONSTRAINT "intervention_actions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "intervention_actions" ADD CONSTRAINT "intervention_actions_intervention_id_interventions_id_fk" FOREIGN KEY ("intervention_id") REFERENCES "public"."interventions"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "intervention_actions" ADD CONSTRAINT "intervention_actions_activity_id_activities_id_fk" FOREIGN KEY ("activity_id") REFERENCES "public"."activities"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "intervention_actions" ADD CONSTRAINT "intervention_actions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "intervention_actions_idx" ON "intervention_actions" USING btree ("tenant_id","intervention_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "intervention_actions_activity_uq" ON "intervention_actions" USING btree ("activity_id");