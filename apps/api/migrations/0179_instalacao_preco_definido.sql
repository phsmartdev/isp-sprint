-- Preserva o significado legado: zero sem marcador era preço não informado.
-- O preenchimento inicial só ocorre quando a coluna é criada; nunca sobrescreve escolhas explícitas existentes.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'opportunity_items' AND column_name = 'price_defined') THEN
    ALTER TABLE opportunity_items ADD COLUMN price_defined boolean NOT NULL DEFAULT true;
    UPDATE opportunity_items SET price_defined = false WHERE unit_cents = 0 AND surcharge_cents = 0;
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'product_catalog' AND column_name = 'last_price_defined') THEN
    ALTER TABLE product_catalog ADD COLUMN last_price_defined boolean NOT NULL DEFAULT true;
    UPDATE product_catalog SET last_price_defined = false WHERE last_unit_cents = 0;
  END IF;
END $$;
