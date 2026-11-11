CREATE TABLE IF NOT EXISTS "people_announcement_reads" (
	"announcement_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"viewed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ack_version" integer,
	"acknowledged_at" timestamp with time zone,
	CONSTRAINT "people_announcement_reads_announcement_id_user_id_pk" PRIMARY KEY("announcement_id","user_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "people_announcements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"category" text,
	"priority" text DEFAULT 'informativo' NOT NULL,
	"audience" jsonb NOT NULL,
	"publish_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"require_ack" boolean DEFAULT false NOT NULL,
	"pinned" boolean DEFAULT true NOT NULL,
	"status" text DEFAULT 'rascunho' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_at" timestamp with time zone,
	CONSTRAINT "people_announcements_priority_ck" CHECK (priority in ('informativo','importante','urgente')),
	CONSTRAINT "people_announcements_status_ck" CHECK (status in ('rascunho','publicado','encerrado'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "people_badge_awards" (
	"tenant_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"badge_key" text NOT NULL,
	"year" integer NOT NULL,
	"tier_index" integer NOT NULL,
	"tier_name" text NOT NULL,
	"silent" boolean DEFAULT false NOT NULL,
	"post_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "people_badge_awards_user_id_badge_key_year_tier_index_pk" PRIMARY KEY("user_id","badge_key","year","tier_index")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "people_recognition_categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"emoji" text DEFAULT '⭐' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"value_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "people_recognitions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"from_user_id" uuid NOT NULL,
	"to_user_id" uuid NOT NULL,
	"category_id" uuid NOT NULL,
	"message" text NOT NULL,
	"visibility" text DEFAULT 'publica' NOT NULL,
	"post_id" uuid,
	"status" text DEFAULT 'valido' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "people_recognitions_vis_ck" CHECK (visibility in ('publica','privada')),
	CONSTRAINT "people_recognitions_status_ck" CHECK (status in ('valido','oculto','removido'))
);
--> statement-breakpoint
ALTER TABLE "people_media" ADD COLUMN "announcement_id" uuid;--> statement-breakpoint
ALTER TABLE "people_posts" ADD COLUMN "meta" jsonb;--> statement-breakpoint
ALTER TABLE "people_posts" ADD COLUMN "source_key" text;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "people_announcement_reads" ADD CONSTRAINT "people_announcement_reads_announcement_id_people_announcements_id_fk" FOREIGN KEY ("announcement_id") REFERENCES "public"."people_announcements"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "people_announcement_reads" ADD CONSTRAINT "people_announcement_reads_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "people_announcement_reads" ADD CONSTRAINT "people_announcement_reads_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "people_announcements" ADD CONSTRAINT "people_announcements_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "people_announcements" ADD CONSTRAINT "people_announcements_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "people_announcements" ADD CONSTRAINT "people_announcements_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "people_badge_awards" ADD CONSTRAINT "people_badge_awards_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "people_badge_awards" ADD CONSTRAINT "people_badge_awards_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "people_recognition_categories" ADD CONSTRAINT "people_recognition_categories_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "people_recognitions" ADD CONSTRAINT "people_recognitions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "people_recognitions" ADD CONSTRAINT "people_recognitions_from_user_id_users_id_fk" FOREIGN KEY ("from_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "people_recognitions" ADD CONSTRAINT "people_recognitions_to_user_id_users_id_fk" FOREIGN KEY ("to_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "people_recognitions" ADD CONSTRAINT "people_recognitions_category_id_people_recognition_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."people_recognition_categories"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "people_recognitions" ADD CONSTRAINT "people_recognitions_post_id_people_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."people_posts"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "people_announcements_list_idx" ON "people_announcements" USING btree ("tenant_id","status","publish_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "people_badge_awards_tenant_idx" ON "people_badge_awards" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "people_recognition_categories_uq" ON "people_recognition_categories" USING btree ("tenant_id",lower("name"));--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "people_recognitions_to_idx" ON "people_recognitions" USING btree ("tenant_id","to_user_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "people_recognitions_from_idx" ON "people_recognitions" USING btree ("tenant_id","from_user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "people_posts_source_uq" ON "people_posts" USING btree ("tenant_id","source_key") WHERE source_key is not null;