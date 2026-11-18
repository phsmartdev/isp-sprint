CREATE TABLE IF NOT EXISTS "academy_contents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"external_id" text,
	"url" text,
	"title" text NOT NULL,
	"description" text,
	"duration_seconds" integer,
	"duration_source" text,
	"thumbnail_url" text,
	"channel" text,
	"state" text DEFAULT 'desconhecido' NOT NULL,
	"last_synced_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "academy_contents_kind_ck" CHECK (kind in ('youtube_video','link')),
	CONSTRAINT "academy_contents_state_ck" CHECK (state in ('disponivel','indisponivel','privado','removido','sem_incorporacao','desconhecido'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "academy_courses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"track_id" uuid NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"position" integer NOT NULL,
	"min_watch_pct" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "academy_enrollments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"track_id" uuid NOT NULL,
	"version_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"source" text NOT NULL,
	"assigned_by" uuid,
	"due_on" date,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"last_lesson_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "academy_enrollments_source_ck" CHECK (source in ('livre','obrigatoria','atribuida'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "academy_lesson_progress" (
	"tenant_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"lesson_id" uuid NOT NULL,
	"track_id" uuid NOT NULL,
	"intervals" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"watched_ms" integer DEFAULT 0 NOT NULL,
	"duration_seconds" integer,
	"last_position_ms" integer DEFAULT 0 NOT NULL,
	"completed_at" timestamp with time zone,
	"last_credit_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "academy_lesson_progress_user_id_lesson_id_pk" PRIMARY KEY("user_id","lesson_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "academy_lessons" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"track_id" uuid NOT NULL,
	"module_id" uuid NOT NULL,
	"content_id" uuid NOT NULL,
	"title" text,
	"description" text,
	"position" integer NOT NULL,
	"required" boolean DEFAULT true NOT NULL,
	"min_watch_pct" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "academy_modules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"track_id" uuid NOT NULL,
	"course_id" uuid NOT NULL,
	"title" text NOT NULL,
	"position" integer NOT NULL,
	"playlist_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "academy_play_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"lesson_id" uuid NOT NULL,
	"client_session_id" text NOT NULL,
	"device" text,
	"last_seq" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_beat_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "academy_playlists" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"playlist_id" text NOT NULL,
	"title" text NOT NULL,
	"channel" text,
	"video_ids" text[] DEFAULT '{}'::text[] NOT NULL,
	"last_synced_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "academy_track_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"track_id" uuid NOT NULL,
	"version_id" uuid,
	"type" text NOT NULL,
	"note" text,
	"actor_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "academy_track_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"track_id" uuid NOT NULL,
	"number" integer NOT NULL,
	"status" text DEFAULT 'revisao_gerencia' NOT NULL,
	"structure" jsonb NOT NULL,
	"meta" jsonb NOT NULL,
	"stages" text[] DEFAULT '{}'::text[] NOT NULL,
	"submitted_by" uuid,
	"submitted_at" timestamp with time zone,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "academy_track_versions_status_ck" CHECK (status in ('revisao_gerencia','homologacao_diretoria','publicada','substituida','rejeitada','ajustes'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "academy_tracks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"cover_mime" text,
	"cover" "bytea",
	"objectives" text[] DEFAULT '{}'::text[] NOT NULL,
	"competencies" text[] DEFAULT '{}'::text[] NOT NULL,
	"owner_team_id" uuid,
	"curator_id" uuid,
	"visibility" text DEFAULT 'corporativo' NOT NULL,
	"team_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"cost_center_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"profiles" text[] DEFAULT '{}'::text[] NOT NULL,
	"user_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"mode" text DEFAULT 'livre' NOT NULL,
	"level" text DEFAULT 'basico' NOT NULL,
	"workload_minutes" integer,
	"due_days" integer,
	"prerequisite_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"min_watch_pct" integer DEFAULT 90 NOT NULL,
	"progress_method" text DEFAULT 'quantidade' NOT NULL,
	"sequential" boolean DEFAULT false NOT NULL,
	"certificate" boolean DEFAULT false NOT NULL,
	"validity_months" integer,
	"recycle_months" integer,
	"status" text DEFAULT 'rascunho' NOT NULL,
	"current_version_id" uuid,
	"created_by" uuid,
	"row_version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "academy_tracks_mode_ck" CHECK (mode in ('livre','obrigatoria','atribuida')),
	CONSTRAINT "academy_tracks_level_ck" CHECK (level in ('basico','intermediario','avancado')),
	CONSTRAINT "academy_tracks_method_ck" CHECK (progress_method in ('quantidade','duracao')),
	CONSTRAINT "academy_tracks_status_ck" CHECK (status in ('rascunho','revisao_gerencia','homologacao_diretoria','publicada','arquivada')),
	CONSTRAINT "academy_tracks_visibility_ck" CHECK (visibility in ('corporativo','compartilhado','restrito')),
	CONSTRAINT "academy_tracks_pct_ck" CHECK (min_watch_pct between 1 and 100)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "academy_watch_beats" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"intervals" jsonb NOT NULL,
	"position_ms" integer,
	"credited_ms" integer DEFAULT 0 NOT NULL,
	"rejected_ms" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "integrations" DROP CONSTRAINT "integrations_kind_ck";--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "academy_contents" ADD CONSTRAINT "academy_contents_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "academy_contents" ADD CONSTRAINT "academy_contents_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "academy_courses" ADD CONSTRAINT "academy_courses_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "academy_courses" ADD CONSTRAINT "academy_courses_track_id_academy_tracks_id_fk" FOREIGN KEY ("track_id") REFERENCES "public"."academy_tracks"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "academy_enrollments" ADD CONSTRAINT "academy_enrollments_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "academy_enrollments" ADD CONSTRAINT "academy_enrollments_track_id_academy_tracks_id_fk" FOREIGN KEY ("track_id") REFERENCES "public"."academy_tracks"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "academy_enrollments" ADD CONSTRAINT "academy_enrollments_version_id_academy_track_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."academy_track_versions"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "academy_enrollments" ADD CONSTRAINT "academy_enrollments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "academy_enrollments" ADD CONSTRAINT "academy_enrollments_assigned_by_users_id_fk" FOREIGN KEY ("assigned_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "academy_lesson_progress" ADD CONSTRAINT "academy_lesson_progress_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "academy_lesson_progress" ADD CONSTRAINT "academy_lesson_progress_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "academy_lesson_progress" ADD CONSTRAINT "academy_lesson_progress_track_id_academy_tracks_id_fk" FOREIGN KEY ("track_id") REFERENCES "public"."academy_tracks"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "academy_lessons" ADD CONSTRAINT "academy_lessons_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "academy_lessons" ADD CONSTRAINT "academy_lessons_track_id_academy_tracks_id_fk" FOREIGN KEY ("track_id") REFERENCES "public"."academy_tracks"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "academy_lessons" ADD CONSTRAINT "academy_lessons_module_id_academy_modules_id_fk" FOREIGN KEY ("module_id") REFERENCES "public"."academy_modules"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "academy_lessons" ADD CONSTRAINT "academy_lessons_content_id_academy_contents_id_fk" FOREIGN KEY ("content_id") REFERENCES "public"."academy_contents"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "academy_modules" ADD CONSTRAINT "academy_modules_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "academy_modules" ADD CONSTRAINT "academy_modules_track_id_academy_tracks_id_fk" FOREIGN KEY ("track_id") REFERENCES "public"."academy_tracks"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "academy_modules" ADD CONSTRAINT "academy_modules_course_id_academy_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."academy_courses"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "academy_modules" ADD CONSTRAINT "academy_modules_playlist_id_academy_playlists_id_fk" FOREIGN KEY ("playlist_id") REFERENCES "public"."academy_playlists"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "academy_play_sessions" ADD CONSTRAINT "academy_play_sessions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "academy_play_sessions" ADD CONSTRAINT "academy_play_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "academy_playlists" ADD CONSTRAINT "academy_playlists_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "academy_playlists" ADD CONSTRAINT "academy_playlists_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "academy_track_events" ADD CONSTRAINT "academy_track_events_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "academy_track_events" ADD CONSTRAINT "academy_track_events_track_id_academy_tracks_id_fk" FOREIGN KEY ("track_id") REFERENCES "public"."academy_tracks"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "academy_track_events" ADD CONSTRAINT "academy_track_events_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "academy_track_versions" ADD CONSTRAINT "academy_track_versions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "academy_track_versions" ADD CONSTRAINT "academy_track_versions_track_id_academy_tracks_id_fk" FOREIGN KEY ("track_id") REFERENCES "public"."academy_tracks"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "academy_track_versions" ADD CONSTRAINT "academy_track_versions_submitted_by_users_id_fk" FOREIGN KEY ("submitted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "academy_tracks" ADD CONSTRAINT "academy_tracks_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "academy_tracks" ADD CONSTRAINT "academy_tracks_owner_team_id_teams_id_fk" FOREIGN KEY ("owner_team_id") REFERENCES "public"."teams"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "academy_tracks" ADD CONSTRAINT "academy_tracks_curator_id_users_id_fk" FOREIGN KEY ("curator_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "academy_tracks" ADD CONSTRAINT "academy_tracks_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "academy_watch_beats" ADD CONSTRAINT "academy_watch_beats_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "academy_watch_beats" ADD CONSTRAINT "academy_watch_beats_session_id_academy_play_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."academy_play_sessions"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "academy_contents_ext_uq" ON "academy_contents" USING btree ("tenant_id","kind","external_id") WHERE external_id is not null;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "academy_courses_idx" ON "academy_courses" USING btree ("track_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "academy_enrollments_uq" ON "academy_enrollments" USING btree ("track_id","user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "academy_enrollments_user_idx" ON "academy_enrollments" USING btree ("tenant_id","user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "academy_lesson_progress_track_idx" ON "academy_lesson_progress" USING btree ("track_id","user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "academy_lessons_idx" ON "academy_lessons" USING btree ("module_id","position");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "academy_modules_idx" ON "academy_modules" USING btree ("course_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "academy_play_sessions_uq" ON "academy_play_sessions" USING btree ("user_id","lesson_id","client_session_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "academy_playlists_uq" ON "academy_playlists" USING btree ("tenant_id","playlist_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "academy_track_events_idx" ON "academy_track_events" USING btree ("track_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "academy_track_versions_uq" ON "academy_track_versions" USING btree ("track_id","number");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "academy_track_versions_one_open" ON "academy_track_versions" USING btree ("track_id") WHERE status in ('revisao_gerencia','homologacao_diretoria');--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "academy_tracks_idx" ON "academy_tracks" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "academy_watch_beats_uq" ON "academy_watch_beats" USING btree ("session_id","seq");--> statement-breakpoint
ALTER TABLE "integrations" ADD CONSTRAINT "integrations_kind_ck" CHECK (kind in ('ixc','zapi','zapsign','glpi','whatsapp','meta','site','youtube'));