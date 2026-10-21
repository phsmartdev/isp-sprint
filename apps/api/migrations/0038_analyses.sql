CREATE TABLE IF NOT EXISTS "intervention_analyses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"intervention_id" uuid NOT NULL,
	"status" text DEFAULT 'rascunho' NOT NULL,
	"content" jsonb NOT NULL,
	"conclusion" text,
	"concluded_by" uuid,
	"concluded_at" timestamp with time zone,
	"created_by" uuid,
	"row_version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "intervention_analyses_status_ck" CHECK (status in ('rascunho','concluida'))
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "intervention_analyses" ADD CONSTRAINT "intervention_analyses_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "intervention_analyses" ADD CONSTRAINT "intervention_analyses_intervention_id_interventions_id_fk" FOREIGN KEY ("intervention_id") REFERENCES "public"."interventions"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "intervention_analyses" ADD CONSTRAINT "intervention_analyses_concluded_by_users_id_fk" FOREIGN KEY ("concluded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "intervention_analyses" ADD CONSTRAINT "intervention_analyses_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "intervention_analyses_uq" ON "intervention_analyses" USING btree ("intervention_id");