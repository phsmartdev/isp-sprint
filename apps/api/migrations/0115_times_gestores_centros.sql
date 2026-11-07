ALTER TABLE "cost_centers" ADD COLUMN "team_id" uuid;--> statement-breakpoint
ALTER TABLE "teams" ADD COLUMN "manager_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "cost_centers" ADD CONSTRAINT "cost_centers_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "cost_centers_team_uq" ON "cost_centers" USING btree ("team_id");