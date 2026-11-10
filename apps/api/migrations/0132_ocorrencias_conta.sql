CREATE TABLE IF NOT EXISTS "account_occurrences" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"contact_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"occurred_on" date NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"impact" text DEFAULT 'neutro' NOT NULL,
	"channel" text,
	"aspects" text[] DEFAULT '{}'::text[] NOT NULL,
	"stakeholder_id" uuid,
	"opportunity_id" uuid,
	"contract_id" uuid,
	"response_due_on" date,
	"responded_on" date,
	"response_note" text,
	"created_by" uuid NOT NULL,
	"updated_by" uuid,
	"removed_at" timestamp with time zone,
	"removed_by" uuid,
	"removed_reason" text,
	"row_version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "account_occurrences_kind_ck" CHECK (kind in ('notificacao','reclamacao','feedback_positivo','mudanca_negociacao','mudanca_gestao','reuniao_decisao','marco','outro')),
	CONSTRAINT "account_occurrences_impact_ck" CHECK (impact in ('positivo','neutro','negativo'))
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "account_occurrences" ADD CONSTRAINT "account_occurrences_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "account_occurrences" ADD CONSTRAINT "account_occurrences_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "account_occurrences" ADD CONSTRAINT "account_occurrences_stakeholder_id_account_stakeholders_id_fk" FOREIGN KEY ("stakeholder_id") REFERENCES "public"."account_stakeholders"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "account_occurrences" ADD CONSTRAINT "account_occurrences_opportunity_id_opportunities_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."opportunities"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "account_occurrences" ADD CONSTRAINT "account_occurrences_contract_id_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."contracts"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "account_occurrences" ADD CONSTRAINT "account_occurrences_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "account_occurrences" ADD CONSTRAINT "account_occurrences_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "account_occurrences" ADD CONSTRAINT "account_occurrences_removed_by_users_id_fk" FOREIGN KEY ("removed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "account_occurrences_idx" ON "account_occurrences" USING btree ("tenant_id","contact_id","occurred_on");