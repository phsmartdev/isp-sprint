CREATE TABLE IF NOT EXISTS "people_comments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"post_id" uuid NOT NULL,
	"author_id" uuid NOT NULL,
	"parent_id" uuid,
	"body" text NOT NULL,
	"mentions" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"status" text DEFAULT 'publicado' NOT NULL,
	"edited_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "people_comments_status_ck" CHECK (status in ('publicado','oculto','removido'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "people_media" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"owner_id" uuid NOT NULL,
	"post_id" uuid,
	"kind" text NOT NULL,
	"mime" text NOT NULL,
	"filename" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"sha256" text NOT NULL,
	"data" "bytea" NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "people_media_kind_ck" CHECK (kind in ('imagem','video','arquivo'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "people_media_chunks" (
	"tenant_id" uuid NOT NULL,
	"upload_id" uuid NOT NULL,
	"n" integer NOT NULL,
	"owner_id" uuid NOT NULL,
	"data" "bytea" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "people_media_chunks_upload_id_n_pk" PRIMARY KEY("upload_id","n")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "people_posts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"author_id" uuid NOT NULL,
	"kind" text DEFAULT 'social' NOT NULL,
	"audience" text DEFAULT 'organizacao' NOT NULL,
	"community_id" uuid,
	"body" text DEFAULT '' NOT NULL,
	"mentions" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"status" text DEFAULT 'publicado' NOT NULL,
	"reaction_count" integer DEFAULT 0 NOT NULL,
	"comment_count" integer DEFAULT 0 NOT NULL,
	"published_at" timestamp with time zone,
	"edited_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"deleted_by" uuid,
	CONSTRAINT "people_posts_kind_ck" CHECK (kind in ('social','institucional','conquista','reconhecimento','comunidade','comunicado')),
	CONSTRAINT "people_posts_audience_ck" CHECK (audience in ('organizacao','comunidade','segmentado')),
	CONSTRAINT "people_posts_status_ck" CHECK (status in ('rascunho','publicado','oculto','removido'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "people_reactions" (
	"post_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"kind" text DEFAULT 'curtir' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "people_reactions_post_id_user_id_pk" PRIMARY KEY("post_id","user_id"),
	CONSTRAINT "people_reactions_kind_ck" CHECK (kind in ('curtir','celebrar','apoiar','inspirador'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "people_saved_posts" (
	"user_id" uuid NOT NULL,
	"post_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "people_saved_posts_user_id_post_id_pk" PRIMARY KEY("user_id","post_id")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "people_comments" ADD CONSTRAINT "people_comments_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "people_comments" ADD CONSTRAINT "people_comments_post_id_people_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."people_posts"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "people_comments" ADD CONSTRAINT "people_comments_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "people_comments" ADD CONSTRAINT "people_comments_parent_id_people_comments_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."people_comments"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "people_media" ADD CONSTRAINT "people_media_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "people_media" ADD CONSTRAINT "people_media_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "people_media" ADD CONSTRAINT "people_media_post_id_people_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."people_posts"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "people_media_chunks" ADD CONSTRAINT "people_media_chunks_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "people_media_chunks" ADD CONSTRAINT "people_media_chunks_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "people_posts" ADD CONSTRAINT "people_posts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "people_posts" ADD CONSTRAINT "people_posts_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "people_posts" ADD CONSTRAINT "people_posts_deleted_by_users_id_fk" FOREIGN KEY ("deleted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "people_reactions" ADD CONSTRAINT "people_reactions_post_id_people_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."people_posts"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "people_reactions" ADD CONSTRAINT "people_reactions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "people_reactions" ADD CONSTRAINT "people_reactions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "people_saved_posts" ADD CONSTRAINT "people_saved_posts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "people_saved_posts" ADD CONSTRAINT "people_saved_posts_post_id_people_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."people_posts"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "people_saved_posts" ADD CONSTRAINT "people_saved_posts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "people_comments_post_idx" ON "people_comments" USING btree ("post_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "people_media_post_idx" ON "people_media" USING btree ("post_id","position");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "people_media_owner_idx" ON "people_media" USING btree ("tenant_id","owner_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "people_media_chunks_age_idx" ON "people_media_chunks" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "people_posts_feed_idx" ON "people_posts" USING btree ("tenant_id","status","published_at","id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "people_posts_author_idx" ON "people_posts" USING btree ("tenant_id","author_id","published_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "people_saved_user_idx" ON "people_saved_posts" USING btree ("user_id","created_at");