ALTER TABLE "interventions" DROP CONSTRAINT "interventions_trigger_ck";--> statement-breakpoint
ALTER TABLE "interventions" ALTER COLUMN "series_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "interventions" ALTER COLUMN "goal_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "interventions" ADD COLUMN "indicator_id" uuid;--> statement-breakpoint
ALTER TABLE "interventions" ADD COLUMN "title" text;--> statement-breakpoint
ALTER TABLE "interventions" ADD COLUMN "reason" text;--> statement-breakpoint
ALTER TABLE "interventions" ADD COLUMN "created_by" uuid;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "interventions" ADD CONSTRAINT "interventions_indicator_id_indicators_id_fk" FOREIGN KEY ("indicator_id") REFERENCES "public"."indicators"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "interventions" ADD CONSTRAINT "interventions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
ALTER TABLE "interventions" ADD CONSTRAINT "interventions_manual_ck" CHECK (trigger <> 'manual' or (title is not null and reason is not null));--> statement-breakpoint
ALTER TABLE "interventions" ADD CONSTRAINT "interventions_auto_ck" CHECK (trigger = 'manual' or (series_id is not null and goal_id is not null));--> statement-breakpoint
ALTER TABLE "interventions" ADD CONSTRAINT "interventions_trigger_ck" CHECK (trigger in ('vermelho','amarelos_consecutivos','primeiro_amarelo','manual'));