ALTER TABLE "budget_adjustments" ADD COLUMN "kind" text DEFAULT 'guardiao' NOT NULL;--> statement-breakpoint
ALTER TABLE "budget_adjustments" ADD COLUMN "transfer_id" uuid;--> statement-breakpoint
ALTER TABLE "budget_lines" ADD COLUMN "approval_stage" text;--> statement-breakpoint
-- itens já em aprovação seguem com a Diretoria (como antes)
UPDATE "budget_lines" SET "approval_stage" = 'diretoria' WHERE "status" = 'em_aprovacao' AND "approval_stage" IS NULL;
