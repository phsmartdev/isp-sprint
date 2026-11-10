ALTER TABLE "activities" ADD COLUMN "qualification" text;--> statement-breakpoint
ALTER TABLE "activities" ADD COLUMN "qualified_by" uuid;--> statement-breakpoint
ALTER TABLE "activities" ADD COLUMN "qualified_at" timestamp with time zone;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "activities" ADD CONSTRAINT "activities_qualified_by_users_id_fk" FOREIGN KEY ("qualified_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
