ALTER TABLE "team_memberships" ADD COLUMN "role" text DEFAULT 'operacao' NOT NULL;--> statement-breakpoint
ALTER TABLE "teams" ADD COLUMN "manager_kinds" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "teams" ADD COLUMN "director_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL;--> statement-breakpoint
ALTER TABLE "team_memberships" ADD CONSTRAINT "team_memberships_role_ck" CHECK ("team_memberships"."role" in ('operacao','participante'));