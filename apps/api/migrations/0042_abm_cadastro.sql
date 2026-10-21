ALTER TABLE "abm_accounts" DROP CONSTRAINT "abm_accounts_status_ck";--> statement-breakpoint
ALTER TABLE "abm_accounts" DROP CONSTRAINT "abm_accounts_priority_ck";--> statement-breakpoint
ALTER TABLE "abm_accounts" ALTER COLUMN "status" SET DEFAULT 'candidata';--> statement-breakpoint
ALTER TABLE "abm_accounts" ADD COLUMN "origin" text;--> statement-breakpoint
ALTER TABLE "abm_accounts" ADD COLUMN "objective" text;--> statement-breakpoint
ALTER TABLE "abm_accounts" ADD COLUMN "notes" text;--> statement-breakpoint
ALTER TABLE "abm_accounts" ADD COLUMN "status_reason" text;--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN "nature" text;--> statement-breakpoint
-- converte os status da versão inicial do ABM para os novos (histórico preservado em abm_events)
UPDATE "abm_accounts" SET "status" = CASE "status" WHEN 'identificada' THEN 'candidata' WHEN 'engajando' THEN 'ativa' WHEN 'oportunidade' THEN 'ativa' WHEN 'cliente' THEN 'em_acompanhamento' ELSE "status" END;--> statement-breakpoint
-- natureza inferida só onde não há dúvida (segmento governamental = pública); o resto fica em branco
UPDATE "contacts" SET "nature" = 'publica' WHERE "segment" = 'governamental' AND "nature" IS NULL;--> statement-breakpoint
ALTER TABLE "abm_accounts" ADD CONSTRAINT "abm_accounts_status_ck" CHECK (status in ('candidata','selecionada','em_planejamento','ativa','em_acompanhamento','pausada','encerrada'));--> statement-breakpoint
ALTER TABLE "abm_accounts" ADD CONSTRAINT "abm_accounts_priority_ck" CHECK (priority in ('critica','alta','media','baixa'));--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_nature_ck" CHECK (nature is null or nature in ('publica', 'privada'));