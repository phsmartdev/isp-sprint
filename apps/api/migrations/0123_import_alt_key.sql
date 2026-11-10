ALTER TABLE "import_links" ADD COLUMN "alt_key" text;--> statement-breakpoint
ALTER TABLE "import_record_results" ADD COLUMN "alt_key" text;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "import_links_alt_idx" ON "import_links" USING btree ("tenant_id","source","target_entity","alt_key");