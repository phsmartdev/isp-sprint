CREATE TABLE IF NOT EXISTS "academy_certificates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"track_id" uuid NOT NULL,
	"version_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"code" text NOT NULL,
	"title" text NOT NULL,
	"seconds" integer NOT NULL,
	"lessons" integer NOT NULL,
	"issued_on" date NOT NULL,
	"data" "bytea" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "academy_notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"track_id" uuid NOT NULL,
	"lesson_id" uuid NOT NULL,
	"position_seconds" integer NOT NULL,
	"text" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "academy_notes_pos_ck" CHECK ("academy_notes"."position_seconds" >= 0)
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "academy_certificates" ADD CONSTRAINT "academy_certificates_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "academy_certificates" ADD CONSTRAINT "academy_certificates_track_id_academy_tracks_id_fk" FOREIGN KEY ("track_id") REFERENCES "public"."academy_tracks"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "academy_certificates" ADD CONSTRAINT "academy_certificates_version_id_academy_track_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."academy_track_versions"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "academy_certificates" ADD CONSTRAINT "academy_certificates_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "academy_notes" ADD CONSTRAINT "academy_notes_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "academy_notes" ADD CONSTRAINT "academy_notes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "academy_notes" ADD CONSTRAINT "academy_notes_track_id_academy_tracks_id_fk" FOREIGN KEY ("track_id") REFERENCES "public"."academy_tracks"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "academy_certificates_user_uq" ON "academy_certificates" USING btree ("track_id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "academy_certificates_code_uq" ON "academy_certificates" USING btree ("tenant_id","code");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "academy_notes_user_idx" ON "academy_notes" USING btree ("user_id","track_id");