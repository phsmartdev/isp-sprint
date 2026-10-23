ALTER TABLE "opportunities" ADD COLUMN "sale_kind" text;--> statement-breakpoint
ALTER TABLE "pipeline_fields" ADD COLUMN "sale_kinds" text[] DEFAULT '{}'::text[] NOT NULL;