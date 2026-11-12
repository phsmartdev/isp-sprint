ALTER TABLE "projects" ADD COLUMN "official_dates" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "margin_days" integer DEFAULT 1 NOT NULL;