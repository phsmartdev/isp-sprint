CREATE TABLE IF NOT EXISTS "opportunity_attachment_chunks" (
	"tenant_id" uuid NOT NULL,
	"opportunity_id" uuid NOT NULL,
	"upload_id" uuid NOT NULL,
	"n" integer NOT NULL,
	"data" "bytea" NOT NULL,
	"uploaded_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "opportunity_attachment_chunks_upload_id_n_pk" PRIMARY KEY("upload_id","n")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "opportunity_delivery_addresses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"opportunity_id" uuid NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"label" text,
	"cep" text,
	"street" text,
	"number" text,
	"district" text,
	"city" text,
	"notes" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "opportunity_items" ADD COLUMN "delivery_address_id" uuid;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "opportunity_attachment_chunks" ADD CONSTRAINT "opportunity_attachment_chunks_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "opportunity_attachment_chunks" ADD CONSTRAINT "opportunity_attachment_chunks_opportunity_id_opportunities_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."opportunities"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "opportunity_attachment_chunks" ADD CONSTRAINT "opportunity_attachment_chunks_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "opportunity_delivery_addresses" ADD CONSTRAINT "opportunity_delivery_addresses_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "opportunity_delivery_addresses" ADD CONSTRAINT "opportunity_delivery_addresses_opportunity_id_opportunities_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."opportunities"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "opportunity_delivery_addresses" ADD CONSTRAINT "opportunity_delivery_addresses_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "opp_attach_chunks_age_idx" ON "opportunity_attachment_chunks" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "opp_delivery_addr_opp_idx" ON "opportunity_delivery_addresses" USING btree ("tenant_id","opportunity_id");--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "opportunity_items" ADD CONSTRAINT "opportunity_items_delivery_address_id_opportunity_delivery_addresses_id_fk" FOREIGN KEY ("delivery_address_id") REFERENCES "public"."opportunity_delivery_addresses"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
