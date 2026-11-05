ALTER TABLE "comm_template_versions" ADD COLUMN "format" text DEFAULT 'texto' NOT NULL;--> statement-breakpoint
ALTER TABLE "comm_template_versions" ADD COLUMN "layout" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "comm_templates" ADD COLUMN "format" text DEFAULT 'texto' NOT NULL;--> statement-breakpoint
ALTER TABLE "comm_templates" ADD COLUMN "layout" boolean DEFAULT true NOT NULL;