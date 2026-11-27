ALTER TABLE "contract_amendments" ADD COLUMN IF NOT EXISTS "item_adjustments" jsonb;--> statement-breakpoint
ALTER TABLE "contract_amendments" ADD COLUMN IF NOT EXISTS "extend_months" integer;--> statement-breakpoint
ALTER TABLE "contract_amendments" ADD COLUMN IF NOT EXISTS "extend_days" integer;