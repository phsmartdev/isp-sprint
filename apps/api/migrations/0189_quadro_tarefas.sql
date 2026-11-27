CREATE TABLE IF NOT EXISTS "capacity_policies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"board_key" text NOT NULL,
	"version" integer NOT NULL,
	"commercial_bp" integer NOT NULL,
	"internal_bp" integer NOT NULL,
	"hypothesis_bp" integer NOT NULL,
	"reason" text NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "capacity_policies_sum_ck" CHECK (commercial_bp + internal_bp + hypothesis_bp = 10000)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "task_boards" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"key" text NOT NULL,
	"team_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"wip_limit" integer DEFAULT 3 NOT NULL,
	"wip_counts_waiting" boolean DEFAULT false NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "task_boards_key_ck" CHECK (key in ('comercial','sucesso_cliente','produto','marketing'))
);
--> statement-breakpoint
ALTER TABLE "activities" ADD COLUMN "board_key" text;--> statement-breakpoint
ALTER TABLE "activities" ADD COLUMN "capacity_category" text;--> statement-breakpoint
ALTER TABLE "activities" ADD COLUMN "remaining_minutes" integer;--> statement-breakpoint
ALTER TABLE "activities" ADD COLUMN "agreed_due_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "activities" ADD COLUMN "planned_week" date;--> statement-breakpoint
ALTER TABLE "activities" ADD COLUMN "plan_order" integer;--> statement-breakpoint
ALTER TABLE "activities" ADD COLUMN "protected_commitment" boolean DEFAULT false NOT NULL;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "capacity_policies" ADD CONSTRAINT "capacity_policies_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "capacity_policies" ADD CONSTRAINT "capacity_policies_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "task_boards" ADD CONSTRAINT "task_boards_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "task_boards" ADD CONSTRAINT "task_boards_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "capacity_policies_uq" ON "capacity_policies" USING btree ("tenant_id","board_key","version");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "task_boards_uq" ON "task_boards" USING btree ("tenant_id","key");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "activities_planned_week_idx" ON "activities" USING btree ("tenant_id","planned_week");--> statement-breakpoint
ALTER TABLE "activities" ADD CONSTRAINT "activities_capacity_category_ck" CHECK (capacity_category is null or capacity_category in ('comercial','interno','hipotese'));--> statement-breakpoint
ALTER TABLE "activities" ADD CONSTRAINT "activities_board_key_ck" CHECK (board_key is null or board_key in ('comercial','sucesso_cliente','produto','marketing'));--> statement-breakpoint
-- Quadros de Tarefas começam desligados nas empresas que já têm configuração de módulo (adoção progressiva)
UPDATE "tenant_modules" SET "disabled_features" = array_append("disabled_features", f.k)
FROM (VALUES ('crm', 'crm.quadro_tarefas'), ('crm', 'crm.quadro_sucesso'), ('produto', 'produto.quadro_tarefas')) AS f(m, k)
WHERE "tenant_modules"."module" = f.m AND NOT (f.k = ANY("tenant_modules"."disabled_features"));
