ALTER TABLE "gamification_settings" ADD COLUMN "status" text DEFAULT 'proposta' NOT NULL;--> statement-breakpoint
ALTER TABLE "gamification_settings" ADD COLUMN "decided_by" uuid;--> statement-breakpoint
ALTER TABLE "gamification_settings" ADD COLUMN "decided_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "gamification_settings" ADD COLUMN "decision_note" text;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "gamification_settings" ADD CONSTRAINT "gamification_settings_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
ALTER TABLE "gamification_settings" ADD CONSTRAINT "gamification_settings_status_ck" CHECK (status in ('proposta','aprovada','recusada'));