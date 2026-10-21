CREATE TABLE IF NOT EXISTS "abm_objectives" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"abm_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"owner_id" uuid NOT NULL,
	"due_on" date,
	"status" text DEFAULT 'planejado' NOT NULL,
	"success_criteria" text,
	"result" text,
	"created_by" uuid,
	"row_version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "abm_objectives_status_ck" CHECK (status in ('planejado','em_andamento','atingido','nao_atingido','cancelado'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "account_org_units" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"contact_id" uuid NOT NULL,
	"parent_id" uuid,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"notes" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_by" uuid,
	"row_version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "account_org_units_kind_ck" CHECK (kind in ('unidade','filial','diretoria','secretaria','departamento','setor','equipe','orgao_relacionado'))
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "abm_objectives" ADD CONSTRAINT "abm_objectives_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "abm_objectives" ADD CONSTRAINT "abm_objectives_abm_id_abm_accounts_id_fk" FOREIGN KEY ("abm_id") REFERENCES "public"."abm_accounts"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "abm_objectives" ADD CONSTRAINT "abm_objectives_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "abm_objectives" ADD CONSTRAINT "abm_objectives_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "account_org_units" ADD CONSTRAINT "account_org_units_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "account_org_units" ADD CONSTRAINT "account_org_units_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "account_org_units" ADD CONSTRAINT "account_org_units_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "abm_objectives_idx" ON "abm_objectives" USING btree ("tenant_id","abm_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "account_org_units_idx" ON "account_org_units" USING btree ("tenant_id","contact_id");