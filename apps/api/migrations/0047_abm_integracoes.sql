CREATE TABLE IF NOT EXISTS "stakeholder_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"stakeholder_id" uuid NOT NULL,
	"contact_id" uuid NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"role" text NOT NULL,
	"notes" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"removed_at" timestamp with time zone,
	"removed_by" uuid,
	"remove_reason" text,
	"row_version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "stakeholder_links_entity_ck" CHECK (entity_type in ('oportunidade','contrato','lead'))
);
--> statement-breakpoint
ALTER TABLE "abm_play_runs" ADD COLUMN "opportunity_id" uuid;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "stakeholder_links" ADD CONSTRAINT "stakeholder_links_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "stakeholder_links" ADD CONSTRAINT "stakeholder_links_stakeholder_id_account_stakeholders_id_fk" FOREIGN KEY ("stakeholder_id") REFERENCES "public"."account_stakeholders"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "stakeholder_links" ADD CONSTRAINT "stakeholder_links_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "stakeholder_links" ADD CONSTRAINT "stakeholder_links_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "stakeholder_links" ADD CONSTRAINT "stakeholder_links_removed_by_users_id_fk" FOREIGN KEY ("removed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "stakeholder_links_active_uq" ON "stakeholder_links" USING btree ("stakeholder_id","entity_type","entity_id") WHERE removed_at is null;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "stakeholder_links_entity_idx" ON "stakeholder_links" USING btree ("tenant_id","entity_type","entity_id");--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "abm_play_runs" ADD CONSTRAINT "abm_play_runs_opportunity_id_opportunities_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."opportunities"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
