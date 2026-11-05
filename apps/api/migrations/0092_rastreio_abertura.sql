ALTER TABLE "contract_notifications" ADD COLUMN "opened_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "contract_notifications" ADD COLUMN "last_opened_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "contract_notifications" ADD COLUMN "open_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "contract_notifications" ADD COLUMN "open_ua" text;