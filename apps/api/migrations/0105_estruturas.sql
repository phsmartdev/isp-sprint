CREATE TABLE IF NOT EXISTS "account_structures" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"kind" text DEFAULT 'programa' NOT NULL,
	"description" text,
	"owner_id" uuid,
	"active" boolean DEFAULT true NOT NULL,
	"created_by" uuid,
	"row_version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "account_structures_kind_ck" CHECK (kind in ('programa','projeto','rede','consorcio','convenio','grupo_economico','outro'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "structure_contracts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"structure_id" uuid NOT NULL,
	"contract_id" uuid NOT NULL,
	"notes" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"removed_by" uuid,
	"removed_at" timestamp with time zone,
	"removed_reason" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "structure_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"structure_id" uuid NOT NULL,
	"contact_id" uuid NOT NULL,
	"role" text DEFAULT 'participante' NOT NULL,
	"notes" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"removed_by" uuid,
	"removed_at" timestamp with time zone,
	"removed_reason" text,
	CONSTRAINT "structure_members_role_ck" CHECK (role in ('gestor','participante','executor','financiador','parceiro','outro'))
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "account_structures" ADD CONSTRAINT "account_structures_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "account_structures" ADD CONSTRAINT "account_structures_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "account_structures" ADD CONSTRAINT "account_structures_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "structure_contracts" ADD CONSTRAINT "structure_contracts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "structure_contracts" ADD CONSTRAINT "structure_contracts_structure_id_account_structures_id_fk" FOREIGN KEY ("structure_id") REFERENCES "public"."account_structures"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "structure_contracts" ADD CONSTRAINT "structure_contracts_contract_id_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."contracts"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "structure_contracts" ADD CONSTRAINT "structure_contracts_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "structure_contracts" ADD CONSTRAINT "structure_contracts_removed_by_users_id_fk" FOREIGN KEY ("removed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "structure_members" ADD CONSTRAINT "structure_members_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "structure_members" ADD CONSTRAINT "structure_members_structure_id_account_structures_id_fk" FOREIGN KEY ("structure_id") REFERENCES "public"."account_structures"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "structure_members" ADD CONSTRAINT "structure_members_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "structure_members" ADD CONSTRAINT "structure_members_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "structure_members" ADD CONSTRAINT "structure_members_removed_by_users_id_fk" FOREIGN KEY ("removed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "account_structures_name_uq" ON "account_structures" USING btree ("tenant_id",lower("name"));--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "structure_contracts_uq" ON "structure_contracts" USING btree ("structure_id","contract_id") WHERE active;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "structure_contracts_contract_idx" ON "structure_contracts" USING btree ("tenant_id","contract_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "structure_members_uq" ON "structure_members" USING btree ("structure_id","contact_id") WHERE active;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "structure_members_contact_idx" ON "structure_members" USING btree ("tenant_id","contact_id");