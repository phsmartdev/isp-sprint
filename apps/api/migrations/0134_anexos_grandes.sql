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
CREATE INDEX IF NOT EXISTS "opp_attach_chunks_age_idx" ON "opportunity_attachment_chunks" USING btree ("created_at");