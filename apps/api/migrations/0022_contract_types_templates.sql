CREATE TABLE IF NOT EXISTS "contract_ledger" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"contract_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"amount_cents" bigint NOT NULL,
	"occurred_on" date NOT NULL,
	"description" text NOT NULL,
	"opportunity_id" uuid,
	"reverses_id" uuid,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "contract_ledger_kind_ck" CHECK (kind in ('credito','consumo','estorno','faturamento')),
	CONSTRAINT "contract_ledger_amount_ck" CHECK (amount_cents > 0)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "contract_signatures" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"contract_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"provider" text DEFAULT 'zapsign' NOT NULL,
	"provider_token" text,
	"status" text DEFAULT 'enviado' NOT NULL,
	"signers" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"signed_document_id" uuid,
	"error" text,
	"sandbox" boolean DEFAULT false NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "contract_signatures_status_ck" CHECK (status in ('enviado','assinado','recusado','cancelado','erro'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "contract_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"billing_type" text,
	"doc_type" text DEFAULT 'CONTRATO' NOT NULL,
	"variables" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"detected" text[] DEFAULT '{}'::text[] NOT NULL,
	"file_name" text NOT NULL,
	"size" integer NOT NULL,
	"data" "bytea" NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "integrations" DROP CONSTRAINT "integrations_kind_ck";--> statement-breakpoint
ALTER TABLE "contracts" ADD COLUMN "billing_type" text DEFAULT 'recorrente' NOT NULL;--> statement-breakpoint
ALTER TABLE "opportunities" ADD COLUMN "measurement_contract_id" uuid;--> statement-breakpoint
ALTER TABLE "opportunities" ADD COLUMN "measurement_cents" bigint;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "contract_ledger" ADD CONSTRAINT "contract_ledger_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "contract_ledger" ADD CONSTRAINT "contract_ledger_contract_id_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."contracts"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "contract_ledger" ADD CONSTRAINT "contract_ledger_opportunity_id_opportunities_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."opportunities"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "contract_ledger" ADD CONSTRAINT "contract_ledger_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "contract_signatures" ADD CONSTRAINT "contract_signatures_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "contract_signatures" ADD CONSTRAINT "contract_signatures_contract_id_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."contracts"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "contract_signatures" ADD CONSTRAINT "contract_signatures_document_id_contract_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."contract_documents"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "contract_signatures" ADD CONSTRAINT "contract_signatures_signed_document_id_contract_documents_id_fk" FOREIGN KEY ("signed_document_id") REFERENCES "public"."contract_documents"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "contract_signatures" ADD CONSTRAINT "contract_signatures_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "contract_templates" ADD CONSTRAINT "contract_templates_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "contract_templates" ADD CONSTRAINT "contract_templates_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "contract_ledger_idx" ON "contract_ledger" USING btree ("tenant_id","contract_id","occurred_on");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "contract_ledger_opp_idx" ON "contract_ledger" USING btree ("opportunity_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "contract_signatures_idx" ON "contract_signatures" USING btree ("tenant_id","contract_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "contract_signatures_token_idx" ON "contract_signatures" USING btree ("provider_token");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "contract_templates_idx" ON "contract_templates" USING btree ("tenant_id");--> statement-breakpoint
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_billing_ck" CHECK (billing_type in ('recorrente','frequente','medicao'));--> statement-breakpoint
ALTER TABLE "integrations" ADD CONSTRAINT "integrations_kind_ck" CHECK (kind in ('ixc','zapi','zapsign','whatsapp','meta','site'));--> statement-breakpoint
CREATE OR REPLACE FUNCTION isp_forbid_mutation() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE'
     AND TG_TABLE_NAME IN ('opportunity_events', 'activity_events', 'email_messages', 'contract_events', 'contract_versions', 'contract_ledger')
     AND current_setting('isp.allow_purge', true) = 'on' THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'Tabela % é append-only (operação % bloqueada)', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'check_violation';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER contract_ledger_append_only BEFORE UPDATE OR DELETE ON "contract_ledger" FOR EACH ROW EXECUTE FUNCTION isp_forbid_mutation();
