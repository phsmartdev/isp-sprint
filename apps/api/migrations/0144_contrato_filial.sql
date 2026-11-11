ALTER TABLE "contracts" ADD COLUMN "branch_id" uuid;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "contracts" ADD CONSTRAINT "contracts_branch_id_sales_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."sales_branches"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
-- contratos existentes herdam a filial da negociação de origem (só preenche o que está vazio)
UPDATE "contracts" c SET "branch_id" = o."branch_id" FROM "opportunities" o WHERE c."opportunity_id" = o."id" AND c."branch_id" IS NULL AND o."branch_id" IS NOT NULL;
