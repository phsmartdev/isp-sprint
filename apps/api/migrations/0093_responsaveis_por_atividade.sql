ALTER TABLE "raci_settings" ADD COLUMN "assignees" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
-- Decisão de 05/11/2026: FIN, OP, JUR, LID_TECNICA, LID_FINANCEIRO, LID_OP e RESP_JURIDICO são atores externos.
-- Usuários do sistema ficam só com os papéis internos (GC, SC, ANC, ASC, CS, DIR).
UPDATE "users" SET "playbook_roles" = ARRAY(SELECT r FROM unnest("playbook_roles") AS r WHERE r IN ('GC','SC','ANC','ASC','CS','DIR'))
WHERE "playbook_roles" && ARRAY['FIN','OP','JUR','LID_TECNICA','LID_FINANCEIRO','LID_OP','RESP_JURIDICO']::text[];
--> statement-breakpoint
UPDATE "contract_external_actors" SET "roles" = ARRAY(SELECT r FROM unnest("roles") AS r WHERE r IN ('FIN','OP','JUR','LID_TECNICA','LID_FINANCEIRO','LID_OP','RESP_JURIDICO'))
WHERE NOT ("roles" <@ ARRAY['FIN','OP','JUR','LID_TECNICA','LID_FINANCEIRO','LID_OP','RESP_JURIDICO']::text[]);
