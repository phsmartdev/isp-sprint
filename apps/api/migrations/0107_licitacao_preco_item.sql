ALTER TABLE "opportunity_items" ADD COLUMN "final_unit_cents" bigint;--> statement-breakpoint
ALTER TABLE "opportunity_items" ADD COLUMN "winner_is_us" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "opportunity_items" ADD COLUMN "winner_company" text;--> statement-breakpoint
ALTER TABLE "opportunity_items" ADD COLUMN "winner_unit_cents" bigint;