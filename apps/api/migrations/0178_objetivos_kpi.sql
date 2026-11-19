ALTER TABLE "indicators" ADD COLUMN "objective_id" uuid;--> statement-breakpoint
ALTER TABLE "objectives" ADD COLUMN "kpi_indicator_id" uuid;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "indicators" ADD CONSTRAINT "indicators_objective_id_objectives_id_fk" FOREIGN KEY ("objective_id") REFERENCES "public"."objectives"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "objectives" ADD CONSTRAINT "objectives_kpi_indicator_id_indicators_id_fk" FOREIGN KEY ("kpi_indicator_id") REFERENCES "public"."indicators"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "objectives_kpi_uq" ON "objectives" USING btree ("tenant_id","kpi_indicator_id") WHERE kpi_indicator_id is not null;