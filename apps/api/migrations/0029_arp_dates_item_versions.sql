ALTER TABLE "arp_operations" DROP CONSTRAINT "arp_operations_kind_ck";--> statement-breakpoint
ALTER TABLE "arp_adhesions" ADD COLUMN "authorized_on" date;--> statement-breakpoint
ALTER TABLE "arp_adhesions" ADD COLUMN "start_on" date;--> statement-breakpoint
ALTER TABLE "arp_agencies" ADD COLUMN "joined_on" date;--> statement-breakpoint
ALTER TABLE "arp_agencies" ADD COLUMN "effective_on" date;--> statement-breakpoint
ALTER TABLE "arp_agencies" ADD COLUMN "notes" text;--> statement-breakpoint
ALTER TABLE "arp_agencies" ADD COLUMN "document_id" uuid;--> statement-breakpoint
ALTER TABLE "arp_item_changes" ADD COLUMN "version" integer;--> statement-breakpoint
ALTER TABLE "arp_items" ADD COLUMN "classification" text;--> statement-breakpoint
ALTER TABLE "arp_items" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "arp_ledger" ADD COLUMN "effective_on" date;--> statement-breakpoint
ALTER TABLE "arp_operations" ADD COLUMN "effective_on" date;--> statement-breakpoint
ALTER TABLE "arp_operations" ADD CONSTRAINT "arp_operations_kind_ck" CHECK (kind in ('conversao','remanejamento','correcao','alteracao_preco','cancelamento','alteracao_item'));