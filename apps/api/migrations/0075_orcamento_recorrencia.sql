ALTER TABLE "budget_lines" ADD COLUMN "recurrence" text DEFAULT 'unico' NOT NULL;--> statement-breakpoint
ALTER TABLE "budget_lines" ADD COLUMN "series_id" uuid;--> statement-breakpoint
ALTER TABLE "budget_lines" ADD COLUMN "series_index" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "budget_lines" ADD COLUMN "series_total" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "budget_lines_series_idx" ON "budget_lines" USING btree ("series_id");--> statement-breakpoint
ALTER TABLE "budget_lines" ADD CONSTRAINT "budget_lines_recurrence_ck" CHECK (recurrence in ('unico','mensal','parcelado'));