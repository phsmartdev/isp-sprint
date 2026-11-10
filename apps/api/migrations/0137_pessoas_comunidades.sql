CREATE TABLE IF NOT EXISTS "people_communities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"rules" text,
	"category" text,
	"kind" text DEFAULT 'publica' NOT NULL,
	"status" text DEFAULT 'ativa' NOT NULL,
	"cover_media_id" uuid,
	"avatar_media_id" uuid,
	"member_count" integer DEFAULT 0 NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "people_communities_kind_ck" CHECK (kind in ('publica','privada','institucional')),
	CONSTRAINT "people_communities_status_ck" CHECK (status in ('ativa','arquivada'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "people_community_members" (
	"community_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"role" text DEFAULT 'membro' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "people_community_members_community_id_user_id_pk" PRIMARY KEY("community_id","user_id"),
	CONSTRAINT "people_community_members_role_ck" CHECK (role in ('responsavel','moderador','membro'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "people_community_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"community_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"status" text DEFAULT 'pendente' NOT NULL,
	"message" text,
	"created_by" uuid NOT NULL,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "people_community_requests_kind_ck" CHECK (kind in ('pedido','convite')),
	CONSTRAINT "people_community_requests_status_ck" CHECK (status in ('pendente','aprovado','recusado','cancelado'))
);
--> statement-breakpoint
ALTER TABLE "people_media" ADD COLUMN "community_id" uuid;--> statement-breakpoint
ALTER TABLE "people_posts" ADD COLUMN "pinned_at" timestamp with time zone;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "people_communities" ADD CONSTRAINT "people_communities_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "people_communities" ADD CONSTRAINT "people_communities_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "people_community_members" ADD CONSTRAINT "people_community_members_community_id_people_communities_id_fk" FOREIGN KEY ("community_id") REFERENCES "public"."people_communities"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "people_community_members" ADD CONSTRAINT "people_community_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "people_community_members" ADD CONSTRAINT "people_community_members_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "people_community_requests" ADD CONSTRAINT "people_community_requests_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "people_community_requests" ADD CONSTRAINT "people_community_requests_community_id_people_communities_id_fk" FOREIGN KEY ("community_id") REFERENCES "public"."people_communities"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "people_community_requests" ADD CONSTRAINT "people_community_requests_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "people_community_requests" ADD CONSTRAINT "people_community_requests_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "people_community_requests" ADD CONSTRAINT "people_community_requests_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "people_communities_name_uq" ON "people_communities" USING btree ("tenant_id",lower("name"));--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "people_communities_list_idx" ON "people_communities" USING btree ("tenant_id","status","name");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "people_community_members_user_idx" ON "people_community_members" USING btree ("tenant_id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "people_community_requests_pending_uq" ON "people_community_requests" USING btree ("community_id","user_id") WHERE status = 'pendente';--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "people_community_requests_user_idx" ON "people_community_requests" USING btree ("tenant_id","user_id","status");--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "people_posts" ADD CONSTRAINT "people_posts_community_id_people_communities_id_fk" FOREIGN KEY ("community_id") REFERENCES "public"."people_communities"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "people_posts_community_idx" ON "people_posts" USING btree ("tenant_id","community_id","status","published_at");