ALTER TABLE "gift_compliance_rules" DROP CONSTRAINT "gift_compliance_rules_param_ck";--> statement-breakpoint
ALTER TABLE "gift_compliance_rules" ADD COLUMN "kit_categories" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "gift_requests" ADD COLUMN "kit_category" text;--> statement-breakpoint
ALTER TABLE "gift_requests" ADD COLUMN "recipients" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "gift_requests" ADD COLUMN "collective" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "gift_requests" ADD COLUMN "audience" text;--> statement-breakpoint
ALTER TABLE "gift_requests" ADD COLUMN "attention" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "gift_compliance_rules" ADD CONSTRAINT "gift_compliance_rules_param_ck" CHECK (param in ('valor_por_kit','matriz_stakeholder','situacao_atencao','valor_por_concessao','valor_acumulado_conta','valor_periodo','quantidade_itens','composicao_kit','frequencia_conta','orcamento_disponivel','condicao'));--> statement-breakpoint
ALTER TABLE "gift_requests" ADD CONSTRAINT "gift_requests_cat_ck" CHECK ("gift_requests"."kit_category" is null or "gift_requests"."kit_category" in ('A', 'B', 'C', 'D'));