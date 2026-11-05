CREATE TABLE IF NOT EXISTS "product_catalog" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"description" text NOT NULL,
	"unit" text DEFAULT 'un' NOT NULL,
	"last_unit_cents" bigint DEFAULT 0 NOT NULL,
	"deal_kind" text DEFAULT 'recorrencia' NOT NULL,
	"fiscal_doc_type_id" uuid,
	"times_used" integer DEFAULT 1 NOT NULL,
	"last_used_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "product_catalog" ADD CONSTRAINT "product_catalog_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "product_catalog_desc_uq" ON "product_catalog" USING btree ("tenant_id",lower("description"));--> statement-breakpoint
-- catálogo começa com os itens já lançados nas negociações (último valor e tipo de cada descrição)
INSERT INTO "product_catalog" ("tenant_id", "description", "unit", "last_unit_cents", "deal_kind", "fiscal_doc_type_id", "times_used", "last_used_at")
SELECT DISTINCT ON (i."tenant_id", lower(trim(i."description")))
  i."tenant_id", trim(i."description"), i."unit", i."unit_cents", i."deal_kind", i."fiscal_doc_type_id",
  count(*) OVER (PARTITION BY i."tenant_id", lower(trim(i."description"))), i."created_at"
FROM "opportunity_items" i WHERE trim(i."description") <> ''
ORDER BY i."tenant_id", lower(trim(i."description")), i."created_at" DESC
ON CONFLICT DO NOTHING;
