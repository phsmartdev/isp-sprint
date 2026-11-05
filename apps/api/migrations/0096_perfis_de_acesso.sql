-- Perfis de acesso (05/11/2026): Administrador, Gerência, Supervisor, Analista, Vendedor.
-- "Gestão de contratos" vira "Analista" (mantém níveis e ações); quem estava em "Implantação" passa a Analista.
UPDATE "roles" SET "key" = 'analista', "name" = 'Analista' WHERE "key" = 'gestao_contratos';
--> statement-breakpoint
-- tenants sem "Gestão de contratos": o papel Implantação vira Analista, com os níveis e ações padrão de Analista
UPDATE "access_policies" p SET "level" = CASE p."module"
    WHEN 'inicio' THEN 'proprio' WHEN 'leads' THEN 'nenhum' WHEN 'oportunidades' THEN 'proprio' WHEN 'clientes' THEN 'total' WHEN 'atividades' THEN 'proprio'
    WHEN 'relatorios' THEN 'nenhum' WHEN 'campanhas' THEN 'nenhum' WHEN 'contratos' THEN 'total' WHEN 'projetos' THEN 'equipe' WHEN 'desempenho' THEN 'proprio'
    WHEN 'resultados' THEN 'proprio' WHEN 'inteligencia' THEN 'nenhum' WHEN 'email' THEN 'proprio' WHEN 'orcamento' THEN 'nenhum' WHEN 'configuracoes' THEN 'nenhum' ELSE p."level" END
  FROM "roles" r WHERE r."id" = p."role_id" AND r."key" = 'implantacao' AND NOT EXISTS (SELECT 1 FROM "roles" x WHERE x."tenant_id" = r."tenant_id" AND x."key" = 'analista');
--> statement-breakpoint
DELETE FROM "action_policies" WHERE "role_id" IN (SELECT r."id" FROM "roles" r WHERE r."key" = 'implantacao' AND NOT EXISTS (SELECT 1 FROM "roles" x WHERE x."tenant_id" = r."tenant_id" AND x."key" = 'analista'));
--> statement-breakpoint
UPDATE "roles" r SET "key" = 'analista', "name" = 'Analista' WHERE r."key" = 'implantacao' AND NOT EXISTS (SELECT 1 FROM "roles" x WHERE x."tenant_id" = r."tenant_id" AND x."key" = 'analista');
--> statement-breakpoint
INSERT INTO "user_roles" ("user_id", "role_id")
  SELECT ur."user_id", a."id" FROM "user_roles" ur JOIN "roles" i ON i."id" = ur."role_id" AND i."key" = 'implantacao'
  JOIN "roles" a ON a."tenant_id" = i."tenant_id" AND a."key" = 'analista'
  ON CONFLICT DO NOTHING;
--> statement-breakpoint
DELETE FROM "user_roles" WHERE "role_id" IN (SELECT "id" FROM "roles" WHERE "key" = 'implantacao');
--> statement-breakpoint
DELETE FROM "roles" WHERE "key" = 'implantacao';
--> statement-breakpoint
-- configurações guardadas por perfil: abas de contratos e indicadores
UPDATE "contract_settings" SET "settings" = jsonb_set("settings" - 'tabAccess', '{tabAccess}',
  (("settings"->'tabAccess') - 'gestao_contratos' - 'implantacao') || CASE WHEN ("settings"->'tabAccess') ? 'gestao_contratos' THEN jsonb_build_object('analista', "settings"->'tabAccess'->'gestao_contratos') WHEN ("settings"->'tabAccess') ? 'implantacao' THEN jsonb_build_object('analista', "settings"->'tabAccess'->'implantacao') ELSE '{}'::jsonb END)
WHERE "settings" ? 'tabAccess';
--> statement-breakpoint
UPDATE "scorecards" SET "applies_profiles" = ARRAY(SELECT DISTINCT CASE WHEN p IN ('gestao_contratos', 'implantacao') THEN 'analista' ELSE p END FROM unnest("applies_profiles") AS p)
WHERE "applies_profiles" && ARRAY['gestao_contratos', 'implantacao']::text[];
