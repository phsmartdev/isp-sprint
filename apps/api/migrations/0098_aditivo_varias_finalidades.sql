ALTER TABLE "contract_amendments" DROP CONSTRAINT "contract_amendments_kind_ck";--> statement-breakpoint
ALTER TABLE "contract_amendments" ADD COLUMN "group_id" uuid;--> statement-breakpoint
ALTER TABLE "contract_amendments" ADD COLUMN "adjustment_pct" double precision;--> statement-breakpoint
ALTER TABLE "contract_amendments" ADD CONSTRAINT "contract_amendments_kind_ck" CHECK (kind in ('acrescimo','supressao','prazo','reajuste','reequilibrio','itens','outro'));