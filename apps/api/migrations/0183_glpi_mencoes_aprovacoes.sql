ALTER TABLE "glpi_queue_tickets" ADD COLUMN "first_response_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "glpi_queue_tickets" ADD COLUMN "first_response_by" text;--> statement-breakpoint
ALTER TABLE "glpi_queue_tickets" ADD COLUMN "mentions" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "glpi_queue_tickets" ADD COLUMN "approvals" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "glpi_queue_tickets" ADD COLUMN "related_user_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL;