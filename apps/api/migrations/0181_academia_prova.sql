CREATE TABLE IF NOT EXISTS "academy_quiz_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"track_id" uuid NOT NULL,
	"version_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"answers" jsonb NOT NULL,
	"correct" integer NOT NULL,
	"total" integer NOT NULL,
	"score_pct" integer NOT NULL,
	"passed" boolean NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "academy_quiz_attempts_pct_ck" CHECK (score_pct between 0 and 100)
);
--> statement-breakpoint
ALTER TABLE "academy_certificates" ADD COLUMN "score_pct" integer;--> statement-breakpoint
ALTER TABLE "academy_tracks" ADD COLUMN "quiz" jsonb;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "academy_quiz_attempts" ADD CONSTRAINT "academy_quiz_attempts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "academy_quiz_attempts" ADD CONSTRAINT "academy_quiz_attempts_track_id_academy_tracks_id_fk" FOREIGN KEY ("track_id") REFERENCES "public"."academy_tracks"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "academy_quiz_attempts" ADD CONSTRAINT "academy_quiz_attempts_version_id_academy_track_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."academy_track_versions"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "academy_quiz_attempts" ADD CONSTRAINT "academy_quiz_attempts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "academy_quiz_attempts_user_idx" ON "academy_quiz_attempts" USING btree ("track_id","user_id","version_id");