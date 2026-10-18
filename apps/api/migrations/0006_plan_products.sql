ALTER TABLE "plans" ADD COLUMN "invoice_service_name" text;--> statement-breakpoint
ALTER TABLE "plans" ADD COLUMN "products" jsonb DEFAULT '[]'::jsonb NOT NULL;