ALTER TABLE "tenants" ADD COLUMN "org_top_name" text;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "org_top_title" text;--> statement-breakpoint
UPDATE "tenants" SET "org_top_name" = 'Welliton Sá', "org_top_title" = 'Diretoria Executiva' WHERE "org_top_name" IS NULL;
