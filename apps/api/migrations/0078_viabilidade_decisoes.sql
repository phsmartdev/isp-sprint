CREATE TABLE IF NOT EXISTS "econ_settings_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"values" jsonb NOT NULL,
	"valid_from" date NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "opportunity_econ_decisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"opportunity_id" uuid NOT NULL,
	"snapshot_id" uuid NOT NULL,
	"action" text NOT NULL,
	"reason" text,
	"actor_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "opp_econ_decision_action_ck" CHECK (action in ('enviada','aprovada','devolvida'))
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "econ_settings_versions" ADD CONSTRAINT "econ_settings_versions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "opportunity_econ_decisions" ADD CONSTRAINT "opportunity_econ_decisions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "opportunity_econ_decisions" ADD CONSTRAINT "opportunity_econ_decisions_opportunity_id_opportunities_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."opportunities"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "opportunity_econ_decisions" ADD CONSTRAINT "opportunity_econ_decisions_snapshot_id_opportunity_economics_snapshots_id_fk" FOREIGN KEY ("snapshot_id") REFERENCES "public"."opportunity_economics_snapshots"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "econ_settings_versions_idx" ON "econ_settings_versions" USING btree ("tenant_id","valid_from","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "opp_econ_decision_idx" ON "opportunity_econ_decisions" USING btree ("opportunity_id","created_at");--> statement-breakpoint
CREATE TRIGGER econ_settings_versions_append_only BEFORE UPDATE OR DELETE ON "econ_settings_versions" FOR EACH ROW EXECUTE FUNCTION isp_econ_snapshot_guard();
--> statement-breakpoint
CREATE TRIGGER opportunity_econ_decisions_append_only BEFORE UPDATE OR DELETE ON "opportunity_econ_decisions" FOR EACH ROW EXECUTE FUNCTION isp_econ_snapshot_guard();
--> statement-breakpoint
-- parâmetros já gravados viram a primeira versão (glosa única vale para os dois segmentos; contingências começam em 0)
INSERT INTO "econ_settings_versions" ("tenant_id", "values", "valid_from", "created_by", "created_at")
SELECT "tenant_id",
  jsonb_build_object(
    'marginTargetBp', ("econ"->>'marginTargetBp')::int, 'tmaMonthlyBp', ("econ"->>'tmaMonthlyBp')::int, 'commissionBp', ("econ"->>'commissionBp')::int,
    'lossPrivateBp', coalesce(("econ"->>'lossBp')::int, 0), 'lossPublicBp', coalesce(("econ"->>'lossBp')::int, 0),
    'contingencyCapexBp', 0, 'contingencyOpexBp', 0,
    'paybackMaxPrivate', ("econ"->>'paybackMaxPrivate')::int, 'paybackMaxPublic', ("econ"->>'paybackMaxPublic')::int,
    'blockOutsidePolicy', coalesce(("econ"->>'blockOutsidePolicy')::boolean, true)),
  "updated_at"::date, "updated_by", now()
FROM "viability_settings" WHERE "econ" ? 'marginTargetBp';
