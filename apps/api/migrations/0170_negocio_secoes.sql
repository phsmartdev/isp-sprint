ALTER TABLE "cost_items" DROP CONSTRAINT "cost_items_impact_ck";--> statement-breakpoint
ALTER TABLE "opportunity_items" ADD COLUMN "section" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "cost_items" ADD CONSTRAINT "cost_items_impact_ck" CHECK (impact is null or impact in ('material','servico','operacional','entrega','taxa_venda','parceiro'));