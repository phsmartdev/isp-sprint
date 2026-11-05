ALTER TABLE "contract_notifications" DROP CONSTRAINT "contract_notifications_channel_ck";--> statement-breakpoint
ALTER TABLE "contract_versions" ADD COLUMN "report_terms" jsonb;--> statement-breakpoint
ALTER TABLE "contract_notifications" ADD CONSTRAINT "contract_notifications_channel_ck" CHECK (channel in ('email','whatsapp','glpi'));