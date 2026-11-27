ALTER TABLE "activities" ADD COLUMN "origin_board" text;--> statement-breakpoint
ALTER TABLE "activities" ADD COLUMN "sent_by" uuid;--> statement-breakpoint
ALTER TABLE "activities" ADD COLUMN "sent_at" timestamp with time zone;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "activities" ADD CONSTRAINT "activities_sent_by_users_id_fk" FOREIGN KEY ("sent_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
