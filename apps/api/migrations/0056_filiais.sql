CREATE TABLE IF NOT EXISTS "sales_branches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "opportunities" ADD COLUMN "branch_id" uuid;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "sales_branches" ADD CONSTRAINT "sales_branches_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "sales_branches_name_uq" ON "sales_branches" USING btree ("tenant_id","name");--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_branch_id_sales_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."sales_branches"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
-- filiais iniciais de cada empresa (a gerência pode renomear, incluir ou desativar)
INSERT INTO "sales_branches" ("tenant_id", "name", "position")
SELECT t.id, b.name, b.pos FROM "tenants" t CROSS JOIN (VALUES ('BKT Soluções', 0), ('UPNET', 1)) AS b(name, pos)
ON CONFLICT DO NOTHING;
