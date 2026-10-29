DROP INDEX IF EXISTS "cost_items_uq";--> statement-breakpoint
ALTER TABLE "cost_items" ADD COLUMN "impact" text;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "cost_items_uq" ON "cost_items" USING btree ("tenant_id","kind",lower("name"),lower("unit"));--> statement-breakpoint
ALTER TABLE "cost_items" ADD CONSTRAINT "cost_items_impact_ck" CHECK (impact is null or impact in ('material','servico','operacional','entrega','taxa_venda'));