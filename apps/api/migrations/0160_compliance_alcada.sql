ALTER TABLE "gift_requests" ADD COLUMN "approval_level" text;--> statement-breakpoint
-- solicitações já registradas por Gestão comercial ou Diretoria passam a exigir a Diretoria (nível acima de quem pediu)
UPDATE "gift_requests" g SET "approval_level" = 'diretoria' WHERE "approval_level" IS NULL AND EXISTS (SELECT 1 FROM "user_roles" ur JOIN "roles" r ON r."id" = ur."role_id" WHERE ur."user_id" = g."requester_id" AND r."key" IN ('gerencia', 'diretoria'));
