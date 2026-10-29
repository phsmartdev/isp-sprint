CREATE TABLE IF NOT EXISTS "branch_letterheads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"filename" text NOT NULL,
	"mime" text NOT NULL,
	"data" "bytea" NOT NULL,
	"top_mm" integer DEFAULT 35 NOT NULL,
	"bottom_mm" integer DEFAULT 25 NOT NULL,
	"side_mm" integer DEFAULT 17 NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "branch_letterheads_mime_ck" CHECK (mime in ('image/png','image/jpeg','application/pdf'))
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "branch_letterheads" ADD CONSTRAINT "branch_letterheads_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "branch_letterheads" ADD CONSTRAINT "branch_letterheads_branch_id_sales_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."sales_branches"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "branch_letterheads_branch_uq" ON "branch_letterheads" USING btree ("branch_id");