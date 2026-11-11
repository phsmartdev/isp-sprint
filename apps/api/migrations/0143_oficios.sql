CREATE TABLE IF NOT EXISTS "branch_signers" (
	"branch_id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"legal_name" text,
	"signer_name" text,
	"signer_role" text,
	"signature_mime" text,
	"signature_data" "bytea",
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "office_letter_seq" (
	"tenant_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"year" integer NOT NULL,
	"next_number" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "office_letter_seq_branch_id_year_pk" PRIMARY KEY("branch_id","year")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "office_letters" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"template_id" uuid,
	"template_version" integer,
	"opportunity_id" uuid,
	"contract_id" uuid,
	"year" integer NOT NULL,
	"number" integer NOT NULL,
	"label" text NOT NULL,
	"subject" text,
	"vars" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"blocks" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"pdf" "bytea" NOT NULL,
	"size_bytes" integer NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "office_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"branch_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"blocks" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "branch_signers" ADD CONSTRAINT "branch_signers_branch_id_sales_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."sales_branches"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "branch_signers" ADD CONSTRAINT "branch_signers_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "branch_signers" ADD CONSTRAINT "branch_signers_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "office_letter_seq" ADD CONSTRAINT "office_letter_seq_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "office_letter_seq" ADD CONSTRAINT "office_letter_seq_branch_id_sales_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."sales_branches"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "office_letters" ADD CONSTRAINT "office_letters_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "office_letters" ADD CONSTRAINT "office_letters_branch_id_sales_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."sales_branches"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "office_letters" ADD CONSTRAINT "office_letters_template_id_office_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."office_templates"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "office_letters" ADD CONSTRAINT "office_letters_opportunity_id_opportunities_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."opportunities"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "office_letters" ADD CONSTRAINT "office_letters_contract_id_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."contracts"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "office_letters" ADD CONSTRAINT "office_letters_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "office_templates" ADD CONSTRAINT "office_templates_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "office_templates" ADD CONSTRAINT "office_templates_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "office_templates" ADD CONSTRAINT "office_templates_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "office_letters_number_uq" ON "office_letters" USING btree ("tenant_id","branch_id","year","number");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "office_letters_opp_idx" ON "office_letters" USING btree ("tenant_id","opportunity_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "office_templates_idx" ON "office_templates" USING btree ("tenant_id","active");