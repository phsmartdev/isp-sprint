CREATE TABLE IF NOT EXISTS "action_policies" (
	"role_id" uuid NOT NULL,
	"action" text NOT NULL,
	"allowed" boolean NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "action_policies_role_id_action_pk" PRIMARY KEY("role_id","action")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "module_grants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"module" text NOT NULL,
	"subject_type" text NOT NULL,
	"subject_id" uuid NOT NULL,
	"effect" text NOT NULL,
	"reason" text NOT NULL,
	"valid_until" date,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "module_grants_subject_ck" CHECK (subject_type in ('equipe','usuario')),
	CONSTRAINT "module_grants_effect_ck" CHECK (effect in ('liberar','bloquear'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "tenant_modules" (
	"tenant_id" uuid NOT NULL,
	"module" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"mode" text DEFAULT 'todos' NOT NULL,
	"disabled_features" text[] DEFAULT '{}'::text[] NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tenant_modules_tenant_id_module_pk" PRIMARY KEY("tenant_id","module"),
	CONSTRAINT "tenant_modules_module_ck" CHECK (module in ('crm','marketing','produto','gestao_time','contratos','projetos','relatorios')),
	CONSTRAINT "tenant_modules_mode_ck" CHECK (mode in ('todos','liberados'))
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "action_policies" ADD CONSTRAINT "action_policies_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "module_grants" ADD CONSTRAINT "module_grants_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "module_grants" ADD CONSTRAINT "module_grants_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "tenant_modules" ADD CONSTRAINT "tenant_modules_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "tenant_modules" ADD CONSTRAINT "tenant_modules_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "module_grants_uq" ON "module_grants" USING btree ("tenant_id","module","subject_type","subject_id");