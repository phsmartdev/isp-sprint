ALTER TABLE "viability_deductions" DROP CONSTRAINT "viability_deductions_kind_ck";--> statement-breakpoint
ALTER TABLE "plans" ADD COLUMN "partner_costs" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "viability_deductions" ADD CONSTRAINT "viability_deductions_kind_ck" CHECK (kind in ('percent','fixed','per_plan'));