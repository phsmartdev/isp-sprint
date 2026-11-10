ALTER TABLE "fiscal_envelopes" DROP CONSTRAINT "fiscal_envelopes_ibge_ck";--> statement-breakpoint
DROP INDEX IF EXISTS "fiscal_envelopes_idx";--> statement-breakpoint
ALTER TABLE "fiscal_doc_types" ADD COLUMN "taxes_by_year" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "fiscal_doc_versions" ADD COLUMN "year" integer;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "fiscal_envelopes_idx" ON "fiscal_envelopes" USING btree ("tenant_id","branch_id","year","created_at");--> statement-breakpoint
ALTER TABLE "fiscal_envelopes" DROP COLUMN IF EXISTS "ibge_code";--> statement-breakpoint
ALTER TABLE "fiscal_envelopes" DROP COLUMN IF EXISTS "municipality";--> statement-breakpoint
ALTER TABLE "sales_branches" DROP COLUMN IF EXISTS "ibge_code";