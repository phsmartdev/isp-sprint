CREATE TABLE IF NOT EXISTS "contract_amendments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"contract_id" uuid NOT NULL,
	"number" text NOT NULL,
	"kind" text NOT NULL,
	"signed_on" date NOT NULL,
	"value_delta_cents" bigint DEFAULT 0 NOT NULL,
	"monthly_delta_cents" bigint DEFAULT 0 NOT NULL,
	"new_end_at" date,
	"reforma" boolean DEFAULT false NOT NULL,
	"acordo" boolean DEFAULT false NOT NULL,
	"description" text NOT NULL,
	"version" integer,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "contract_amendments_kind_ck" CHECK (kind in ('acrescimo','supressao','prazo','reequilibrio','outro'))
);
--> statement-breakpoint
ALTER TABLE "contract_versions" DROP CONSTRAINT "contract_versions_change_ck";--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "contract_amendments" ADD CONSTRAINT "contract_amendments_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "contract_amendments" ADD CONSTRAINT "contract_amendments_contract_id_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."contracts"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "contract_amendments" ADD CONSTRAINT "contract_amendments_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "contract_amendments_ct_idx" ON "contract_amendments" USING btree ("contract_id","signed_on");--> statement-breakpoint
ALTER TABLE "contract_versions" ADD CONSTRAINT "contract_versions_change_ck" CHECK (change_kind in ('cadastro','edicao','ativacao','renovacao','reajuste','encerramento','aditivo'));