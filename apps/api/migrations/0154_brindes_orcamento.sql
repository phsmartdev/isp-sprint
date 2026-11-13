ALTER TABLE "gift_deliveries" ALTER COLUMN "contact_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "budget_lines" ADD COLUMN "gift_destination" text;--> statement-breakpoint
ALTER TABLE "gift_deliveries" ADD COLUMN "purpose" text DEFAULT 'relacionamento' NOT NULL;--> statement-breakpoint
ALTER TABLE "gift_deliveries" ADD COLUMN "opportunity_id" uuid;--> statement-breakpoint
ALTER TABLE "gift_deliveries" ADD COLUMN "campaign_id" uuid;--> statement-breakpoint
ALTER TABLE "gift_deliveries" ADD COLUMN "event_name" text;--> statement-breakpoint
ALTER TABLE "gift_movements" ADD COLUMN "line_id" uuid;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "gift_deliveries" ADD CONSTRAINT "gift_deliveries_opportunity_id_opportunities_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."opportunities"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "gift_deliveries" ADD CONSTRAINT "gift_deliveries_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "gift_movements" ADD CONSTRAINT "gift_movements_line_id_budget_lines_id_fk" FOREIGN KEY ("line_id") REFERENCES "public"."budget_lines"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
ALTER TABLE "gift_deliveries" ADD CONSTRAINT "gift_deliveries_purpose_ck" CHECK (purpose in ('relacionamento','abm','oportunidade','campanha','evento','institucional'));--> statement-breakpoint
ALTER TABLE "gift_deliveries" ADD CONSTRAINT "gift_deliveries_target_ck" CHECK (contact_id is not null or purpose in ('campanha', 'evento', 'institucional'));