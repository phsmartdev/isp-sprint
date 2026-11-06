ALTER TABLE "account_stakeholders" ADD COLUMN "power_class" text DEFAULT 'nao_avaliado' NOT NULL;--> statement-breakpoint
ALTER TABLE "account_stakeholders" ADD COLUMN "hidden_agent" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "account_stakeholders" ADD COLUMN "reports_to_id" uuid;--> statement-breakpoint
ALTER TABLE "account_stakeholders" ADD COLUMN "innovation_openness" text DEFAULT 'nao_avaliado' NOT NULL;--> statement-breakpoint
ALTER TABLE "account_stakeholders" ADD COLUMN "institutional_history" text;--> statement-breakpoint
ALTER TABLE "account_stakeholders" ADD COLUMN "resistance_points" text;--> statement-breakpoint
ALTER TABLE "account_stakeholders" ADD COLUMN "sources" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "account_stakeholders" ADD CONSTRAINT "account_stakeholders_reports_fk" FOREIGN KEY ("reports_to_id") REFERENCES "public"."account_stakeholders"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
ALTER TABLE "account_stakeholders" ADD CONSTRAINT "account_stakeholders_power_ck" CHECK (power_class in ('ia','ina','nia','nina','nao_avaliado'));--> statement-breakpoint
ALTER TABLE "account_stakeholders" ADD CONSTRAINT "account_stakeholders_innov_ck" CHECK (innovation_openness in ('alta','media','baixa','nao_avaliado'));