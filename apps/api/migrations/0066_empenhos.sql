CREATE TABLE IF NOT EXISTS "contract_commitments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"contract_id" uuid NOT NULL,
	"number" text NOT NULL,
	"issued_on" date NOT NULL,
	"fiscal_year" integer NOT NULL,
	"amount_cents" bigint NOT NULL,
	"notes" text,
	"cancelled_at" timestamp with time zone,
	"cancelled_by" uuid,
	"cancel_reason" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "contract_commitments_amount_ck" CHECK (amount_cents > 0)
);
--> statement-breakpoint
ALTER TABLE "contract_ledger" ADD COLUMN "commitment_id" uuid;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "contract_commitments" ADD CONSTRAINT "contract_commitments_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "contract_commitments" ADD CONSTRAINT "contract_commitments_contract_id_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."contracts"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "contract_commitments" ADD CONSTRAINT "contract_commitments_cancelled_by_users_id_fk" FOREIGN KEY ("cancelled_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "contract_commitments" ADD CONSTRAINT "contract_commitments_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "contract_commitments_ct_idx" ON "contract_commitments" USING btree ("contract_id","issued_on");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "contract_commitments_uq" ON "contract_commitments" USING btree ("contract_id","number");