CREATE TABLE IF NOT EXISTS "people_profiles" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"bio" text,
	"interests" text[] DEFAULT '{}'::text[] NOT NULL,
	"skills" text[] DEFAULT '{}'::text[] NOT NULL,
	"show_email" boolean DEFAULT false NOT NULL,
	"show_phone" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "people_settings" (
	"tenant_id" uuid PRIMARY KEY NOT NULL,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "access_policies" DROP CONSTRAINT "access_module_ck";--> statement-breakpoint
ALTER TABLE "tenant_modules" DROP CONSTRAINT "tenant_modules_module_ck";--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "people_profiles" ADD CONSTRAINT "people_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "people_profiles" ADD CONSTRAINT "people_profiles_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "people_settings" ADD CONSTRAINT "people_settings_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "people_settings" ADD CONSTRAINT "people_settings_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "people_profiles_tenant_idx" ON "people_profiles" USING btree ("tenant_id");--> statement-breakpoint
ALTER TABLE "access_policies" ADD CONSTRAINT "access_module_ck" CHECK (module in ('inicio','leads','oportunidades','clientes','atividades','relatorios','campanhas','contratos','projetos','desempenho','resultados','inteligencia','email','orcamento','pessoas','configuracoes'));--> statement-breakpoint
ALTER TABLE "tenant_modules" ADD CONSTRAINT "tenant_modules_module_ck" CHECK (module in ('crm','marketing','produto','gestao_time','contratos','projetos','relatorios','orcamento','pessoas_cultura'));--> statement-breakpoint
-- nível padrão no novo módulo técnico para os perfis que já existem (ajustável em Configurações → Segurança)
INSERT INTO "access_policies" ("role_id", "module", "level")
SELECT r.id, 'pessoas', CASE r.key WHEN 'administrador' THEN 'total' WHEN 'operacao' THEN 'proprio' ELSE 'equipe' END
FROM "roles" r
ON CONFLICT ("role_id", "module") DO NOTHING;--> statement-breakpoint
-- o módulo nasce em teste: ligado, mas só para quem a empresa liberar (equipe ou pessoa)
INSERT INTO "tenant_modules" ("tenant_id", "module", "enabled", "mode")
SELECT t.id, 'pessoas_cultura', true, 'liberados' FROM "tenants" t
ON CONFLICT ("tenant_id", "module") DO NOTHING;
