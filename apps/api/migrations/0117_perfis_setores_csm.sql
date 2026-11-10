CREATE TABLE IF NOT EXISTS "contract_sectors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"key" text NOT NULL,
	"label" text NOT NULL,
	"system" boolean DEFAULT false NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "teams" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "is_csm" boolean DEFAULT false NOT NULL;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "contract_sectors" ADD CONSTRAINT "contract_sectors_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "contract_sectors_uq" ON "contract_sectors" USING btree ("tenant_id","key");--> statement-breakpoint
-- Perfis (07/11/2026): Administrador, Diretoria, Gerência, Supervisão, Operação.
-- Vendedor vira Operação (mantém níveis e ações); quem era Analista passa a Operação.
UPDATE "roles" SET "key" = 'operacao', "name" = 'Operação' WHERE "key" = 'vendedor';
--> statement-breakpoint
INSERT INTO "roles" ("tenant_id", "key", "name", "is_system")
  SELECT DISTINCT r."tenant_id", 'operacao', 'Operação', true FROM "roles" r WHERE r."key" = 'analista'
    AND NOT EXISTS (SELECT 1 FROM "roles" x WHERE x."tenant_id" = r."tenant_id" AND x."key" = 'operacao');
--> statement-breakpoint
INSERT INTO "access_policies" ("role_id", "module", "level")
  SELECT o."id", p."module", p."level" FROM "roles" o JOIN "roles" a ON a."tenant_id" = o."tenant_id" AND a."key" = 'analista'
    JOIN "access_policies" p ON p."role_id" = a."id"
  WHERE o."key" = 'operacao' AND NOT EXISTS (SELECT 1 FROM "access_policies" x WHERE x."role_id" = o."id")
  ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO "user_roles" ("user_id", "role_id")
  SELECT ur."user_id", o."id" FROM "user_roles" ur JOIN "roles" a ON a."id" = ur."role_id" AND a."key" = 'analista'
  JOIN "roles" o ON o."tenant_id" = a."tenant_id" AND o."key" = 'operacao'
  ON CONFLICT DO NOTHING;
--> statement-breakpoint
DELETE FROM "user_roles" WHERE "role_id" IN (SELECT "id" FROM "roles" WHERE "key" = 'analista');
--> statement-breakpoint
DELETE FROM "access_policies" WHERE "role_id" IN (SELECT "id" FROM "roles" WHERE "key" = 'analista');
--> statement-breakpoint
DELETE FROM "action_policies" WHERE "role_id" IN (SELECT "id" FROM "roles" WHERE "key" = 'analista');
--> statement-breakpoint
DELETE FROM "roles" WHERE "key" = 'analista';
--> statement-breakpoint
UPDATE "roles" SET "name" = 'Supervisão' WHERE "key" = 'supervisor';
--> statement-breakpoint
-- Diretoria nasce com os níveis e ações atuais da Gerência
INSERT INTO "roles" ("tenant_id", "key", "name", "is_system")
  SELECT g."tenant_id", 'diretoria', 'Diretoria', true FROM "roles" g WHERE g."key" = 'gerencia'
    AND NOT EXISTS (SELECT 1 FROM "roles" x WHERE x."tenant_id" = g."tenant_id" AND x."key" = 'diretoria');
--> statement-breakpoint
INSERT INTO "access_policies" ("role_id", "module", "level")
  SELECT d."id", p."module", p."level" FROM "roles" d JOIN "roles" g ON g."tenant_id" = d."tenant_id" AND g."key" = 'gerencia'
    JOIN "access_policies" p ON p."role_id" = g."id"
  WHERE d."key" = 'diretoria' AND NOT EXISTS (SELECT 1 FROM "access_policies" x WHERE x."role_id" = d."id")
  ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO "action_policies" ("role_id", "action", "allowed")
  SELECT d."id", p."action", p."allowed" FROM "roles" d JOIN "roles" g ON g."tenant_id" = d."tenant_id" AND g."key" = 'gerencia'
    JOIN "action_policies" p ON p."role_id" = g."id"
  WHERE d."key" = 'diretoria' AND NOT EXISTS (SELECT 1 FROM "action_policies" x WHERE x."role_id" = d."id")
  ON CONFLICT DO NOTHING;
--> statement-breakpoint
-- configurações guardadas por perfil (abas de contratos e funções de scorecard)
UPDATE "contract_settings" SET "settings" = jsonb_set("settings", '{tabAccess}',
  (("settings"->'tabAccess') - 'vendedor' - 'analista')
  || CASE WHEN ("settings"->'tabAccess') ? 'vendedor' THEN jsonb_build_object('operacao', "settings"->'tabAccess'->'vendedor') WHEN ("settings"->'tabAccess') ? 'analista' THEN jsonb_build_object('operacao', "settings"->'tabAccess'->'analista') ELSE '{}'::jsonb END
  || CASE WHEN ("settings"->'tabAccess') ? 'gerencia' AND NOT (("settings"->'tabAccess') ? 'diretoria') THEN jsonb_build_object('diretoria', "settings"->'tabAccess'->'gerencia') ELSE '{}'::jsonb END)
WHERE "settings" ? 'tabAccess';
--> statement-breakpoint
UPDATE "scorecards" SET "applies_profiles" = ARRAY(SELECT DISTINCT CASE WHEN p IN ('vendedor', 'analista') THEN 'operacao' ELSE p END FROM unnest("applies_profiles") AS p)
WHERE "applies_profiles" && ARRAY['vendedor', 'analista']::text[];
