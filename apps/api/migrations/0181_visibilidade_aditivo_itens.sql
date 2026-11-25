ALTER TABLE "contract_amendments" ADD COLUMN "item_adjustments" jsonb;--> statement-breakpoint
ALTER TABLE "opportunities" ADD COLUMN "privacy" text DEFAULT 'time' NOT NULL;--> statement-breakpoint
ALTER TABLE "opportunities" ADD COLUMN "private_user_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL;--> statement-breakpoint
ALTER TABLE "opportunities" ADD COLUMN "private_team_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL;