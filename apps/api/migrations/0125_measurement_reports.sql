CREATE TABLE IF NOT EXISTS "measurement_report_settings" (
	"tenant_id" uuid NOT NULL,
	"contact_id" uuid NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"due_day" integer DEFAULT 5 NOT NULL,
	"to_address" text,
	"cc_address" text,
	"texts" jsonb,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "measurement_report_settings_day_ck" CHECK (due_day between 1 and 31)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "measurement_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"contact_id" uuid NOT NULL,
	"reference_month" text NOT NULL,
	"due_on" date NOT NULL,
	"status" text DEFAULT 'rascunho' NOT NULL,
	"data" jsonb NOT NULL,
	"subject" text NOT NULL,
	"generated_by" uuid,
	"generated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone,
	"sent_by" uuid,
	"sent_to" text,
	"sent_cc" text,
	"email_message_id" uuid,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "measurement_reports_status_ck" CHECK (status in ('rascunho','enviado'))
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "measurement_report_settings" ADD CONSTRAINT "measurement_report_settings_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "measurement_report_settings" ADD CONSTRAINT "measurement_report_settings_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "measurement_report_settings" ADD CONSTRAINT "measurement_report_settings_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "measurement_reports" ADD CONSTRAINT "measurement_reports_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "measurement_reports" ADD CONSTRAINT "measurement_reports_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "measurement_reports" ADD CONSTRAINT "measurement_reports_generated_by_users_id_fk" FOREIGN KEY ("generated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "measurement_reports" ADD CONSTRAINT "measurement_reports_sent_by_users_id_fk" FOREIGN KEY ("sent_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "measurement_report_settings_pk" ON "measurement_report_settings" USING btree ("tenant_id","contact_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "measurement_reports_uq" ON "measurement_reports" USING btree ("tenant_id","contact_id","reference_month");