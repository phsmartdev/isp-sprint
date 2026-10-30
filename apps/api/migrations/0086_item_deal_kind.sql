ALTER TABLE "opportunity_items" ADD COLUMN "deal_kind" text DEFAULT 'recorrencia' NOT NULL;--> statement-breakpoint
ALTER TABLE "opportunity_items" ADD CONSTRAINT "opportunity_items_deal_kind_ck" CHECK (deal_kind in ('venda','recorrencia','locacao'));--> statement-breakpoint
-- itens de oportunidades cuja viabilidade salva é de venda pontual nasceram como venda
UPDATE "opportunity_items" oi SET "deal_kind" = 'venda' FROM "opportunity_economics" e WHERE e."opportunity_id" = oi."opportunity_id" AND e."input"->>'mode' = 'pontual';
