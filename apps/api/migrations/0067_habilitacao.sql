CREATE TABLE IF NOT EXISTS "company_doc_alerts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"threshold" text NOT NULL,
	"activity_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"emails" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "company_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"branch_id" uuid,
	"kind" text NOT NULL,
	"label" text,
	"number" text,
	"issued_on" date,
	"expires_on" date,
	"filename" text NOT NULL,
	"mime" text NOT NULL,
	"size" integer NOT NULL,
	"sha256" text NOT NULL,
	"data" "bytea" NOT NULL,
	"notes" text,
	"superseded_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "company_doc_alerts" ADD CONSTRAINT "company_doc_alerts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "company_doc_alerts" ADD CONSTRAINT "company_doc_alerts_document_id_company_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."company_documents"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "company_documents" ADD CONSTRAINT "company_documents_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "company_documents" ADD CONSTRAINT "company_documents_branch_id_sales_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."sales_branches"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "company_documents" ADD CONSTRAINT "company_documents_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "company_doc_alerts_uq" ON "company_doc_alerts" USING btree ("document_id","threshold");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "company_documents_cur_idx" ON "company_documents" USING btree ("tenant_id","branch_id","kind");