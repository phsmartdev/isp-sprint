DROP INDEX IF EXISTS "fiscal_doc_types_uq";--> statement-breakpoint
ALTER TABLE "fiscal_doc_types" ADD COLUMN "fiscal_kind" text DEFAULT 'servico' NOT NULL;--> statement-breakpoint
ALTER TABLE "sales_branches" ADD COLUMN "fiscal_kinds" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
-- documentos do mesmo código em tipos de venda diferentes viram serviço: os repetidos ganham sufixo
UPDATE "fiscal_doc_types" d SET "code" = d."code" || '-' || r.rn FROM (SELECT "id", row_number() OVER (PARTITION BY "tenant_id", "branch_id", "code" ORDER BY "created_at", "id") AS rn FROM "fiscal_doc_types") r WHERE r."id" = d."id" AND r.rn > 1;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "fiscal_doc_types_uq" ON "fiscal_doc_types" USING btree ("tenant_id","branch_id","fiscal_kind","code");--> statement-breakpoint
ALTER TABLE "fiscal_doc_types" ADD CONSTRAINT "fiscal_doc_types_kind_ck" CHECK (fiscal_kind in ('venda','servico','locacao'));