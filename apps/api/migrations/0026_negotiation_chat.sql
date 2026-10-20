CREATE TABLE IF NOT EXISTS "negotiation_reads" (
	"tenant_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"opportunity_id" uuid NOT NULL,
	"last_read_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "negotiation_reads_user_id_opportunity_id_pk" PRIMARY KEY("user_id","opportunity_id")
);
--> statement-breakpoint
ALTER TABLE "negotiation_messages" ADD COLUMN "mentions" uuid[] DEFAULT '{}'::uuid[] NOT NULL;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "negotiation_reads" ADD CONSTRAINT "negotiation_reads_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "negotiation_reads" ADD CONSTRAINT "negotiation_reads_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "negotiation_reads" ADD CONSTRAINT "negotiation_reads_opportunity_id_opportunities_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."opportunities"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
