CREATE TABLE IF NOT EXISTS "budget_revisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"year" integer NOT NULL,
	"version" integer NOT NULL,
	"kind" text NOT NULL,
	"status" text DEFAULT 'pendente' NOT NULL,
	"justification" text NOT NULL,
	"items" jsonb NOT NULL,
	"requested_by" uuid NOT NULL,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"decision_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "budget_revisions_kind_ck" CHECK (kind in ('revisao','remanejamento')),
	CONSTRAINT "budget_revisions_status_ck" CHECK (status in ('pendente','aprovado','recusado'))
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "budget_revisions" ADD CONSTRAINT "budget_revisions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "budget_revisions" ADD CONSTRAINT "budget_revisions_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "budget_revisions" ADD CONSTRAINT "budget_revisions_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "budget_revisions_uq" ON "budget_revisions" USING btree ("tenant_id","year","version");