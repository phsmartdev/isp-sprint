ALTER TABLE "opportunities" ADD COLUMN "paused_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "opportunities" ADD COLUMN "paused_until" date;--> statement-breakpoint
ALTER TABLE "opportunities" ADD COLUMN "pause_reason" text;--> statement-breakpoint
ALTER TABLE "opportunities" ADD COLUMN "paused_by" uuid;