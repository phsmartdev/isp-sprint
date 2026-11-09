CREATE TABLE IF NOT EXISTS "gamification_certificates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"title" text NOT NULL,
	"institution" text NOT NULL,
	"area" text NOT NULL,
	"hours" integer NOT NULL,
	"completed_on" date NOT NULL,
	"file_name" text NOT NULL,
	"mime" text NOT NULL,
	"data" "bytea" NOT NULL,
	"status" text DEFAULT 'pendente' NOT NULL,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"approved_on" date,
	"decision_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "gamification_certificates_status_ck" CHECK (status in ('pendente','aprovado','recusado'))
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "gamification_certificates" ADD CONSTRAINT "gamification_certificates_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "gamification_certificates" ADD CONSTRAINT "gamification_certificates_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "gamification_certificates" ADD CONSTRAINT "gamification_certificates_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "gamification_certificates_user_idx" ON "gamification_certificates" USING btree ("tenant_id","user_id");