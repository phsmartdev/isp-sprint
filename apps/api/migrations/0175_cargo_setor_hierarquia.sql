-- Cargo no setor na hierarquia Diretoria > Gestão > Liderança > Operação (+ Observador).
-- Quem já aprovava como "Liderança / gestor" continua aprovando: com perfil Diretoria vira Diretoria; com Gerência vira Gestão; os demais seguem Liderança.
UPDATE "users" u SET "sector_role" = 'diretoria' WHERE u."sector_role" = 'lideranca' AND EXISTS (SELECT 1 FROM "user_roles" ur JOIN "roles" r ON r.id = ur.role_id WHERE ur.user_id = u.id AND r.key = 'diretoria');--> statement-breakpoint
UPDATE "users" u SET "sector_role" = 'gestao' WHERE u."sector_role" = 'lideranca' AND EXISTS (SELECT 1 FROM "user_roles" ur JOIN "roles" r ON r.id = ur.role_id WHERE ur.user_id = u.id AND r.key = 'gerencia');
