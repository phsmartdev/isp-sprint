ALTER TABLE "opportunities" ADD COLUMN "engineering_status" text DEFAULT 'nao_necessaria' NOT NULL;--> statement-breakpoint
ALTER TABLE "opportunities" ADD COLUMN "engineering_ticket" text;--> statement-breakpoint
ALTER TABLE "opportunities" ADD COLUMN "executive_ticket" text;--> statement-breakpoint
ALTER TABLE "viability_settings" ADD COLUMN "autonomy_max_meters" integer DEFAULT 100;--> statement-breakpoint
ALTER TABLE "viability_settings" ADD COLUMN "autonomy_max_mbps" integer DEFAULT 500;