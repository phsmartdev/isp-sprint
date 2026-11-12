ALTER TABLE "users" ADD COLUMN "sector_role" text DEFAULT 'operador' NOT NULL;--> statement-breakpoint
-- cargo inicial: quem só visualizava vira observador; Supervisão, Gerência, Diretoria e Administrador viram liderança
UPDATE "users" SET "sector_role" = 'observador' WHERE "sector_viewer" = true;--> statement-breakpoint
UPDATE "users" u SET "sector_role" = 'lideranca' WHERE u."sector_viewer" = false AND EXISTS (SELECT 1 FROM "user_roles" ur JOIN "roles" r ON r.id = ur.role_id WHERE ur.user_id = u.id AND r.key IN ('supervisor', 'gerencia', 'diretoria', 'administrador'));
