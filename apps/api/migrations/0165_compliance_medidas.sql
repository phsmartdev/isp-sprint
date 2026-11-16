CREATE TABLE IF NOT EXISTS "gift_compliance_measures" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"pendency_key" text,
	"request_id" uuid,
	"fragility" text NOT NULL,
	"action" text NOT NULL,
	"responsible_id" uuid NOT NULL,
	"due_on" date,
	"status" text DEFAULT 'aberta' NOT NULL,
	"outcome_note" text,
	"concluded_at" timestamp with time zone,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "gift_compliance_measures_status_ck" CHECK (status in ('aberta','em_andamento','concluida','cancelada'))
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "gift_compliance_measures" ADD CONSTRAINT "gift_compliance_measures_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "gift_compliance_measures" ADD CONSTRAINT "gift_compliance_measures_request_id_gift_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."gift_requests"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "gift_compliance_measures" ADD CONSTRAINT "gift_compliance_measures_responsible_id_users_id_fk" FOREIGN KEY ("responsible_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "gift_compliance_measures" ADD CONSTRAINT "gift_compliance_measures_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "gift_compliance_measures_idx" ON "gift_compliance_measures" USING btree ("tenant_id","status");