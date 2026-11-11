ALTER TABLE "people_conversations" ALTER COLUMN "pair_key" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "people_conversations" ADD COLUMN "kind" text DEFAULT 'direta' NOT NULL;--> statement-breakpoint
ALTER TABLE "people_conversations" ADD COLUMN "title" text;--> statement-breakpoint
ALTER TABLE "people_conversations" ADD COLUMN "created_by" uuid;--> statement-breakpoint
ALTER TABLE "people_messages" ADD COLUMN "post_id" uuid;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "people_conversations" ADD CONSTRAINT "people_conversations_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "people_messages" ADD CONSTRAINT "people_messages_post_id_people_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."people_posts"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
