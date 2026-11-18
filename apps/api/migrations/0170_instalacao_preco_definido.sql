-- Perfis são derivados do tipo ao ler/salvar; não altera snapshots históricos.
ALTER TABLE opportunity_items ADD COLUMN IF NOT EXISTS price_defined boolean NOT NULL DEFAULT true;
--> statement-breakpoint
ALTER TABLE product_catalog ADD COLUMN IF NOT EXISTS last_price_defined boolean NOT NULL DEFAULT true;
