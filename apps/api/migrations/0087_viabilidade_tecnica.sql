CREATE TABLE IF NOT EXISTS "network_maps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"filename" text NOT NULL,
	"features" jsonb NOT NULL,
	"points" integer DEFAULT 0 NOT NULL,
	"lines" integer DEFAULT 0 NOT NULL,
	"areas" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"uploaded_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "route_studies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"opportunity_id" uuid NOT NULL,
	"client_lat" double precision NOT NULL,
	"client_lng" double precision NOT NULL,
	"client_address" text,
	"cto_name" text,
	"cto_lat" double precision,
	"cto_lng" double precision,
	"port" text,
	"route" jsonb NOT NULL,
	"length_m" integer NOT NULL,
	"slack_m" integer DEFAULT 0 NOT NULL,
	"notes" text,
	"network_map_id" uuid,
	"attachment_id" uuid,
	"glpi_ticket_id" uuid,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "route_studies_len_ck" CHECK (length_m >= 0 and slack_m >= 0)
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "network_maps" ADD CONSTRAINT "network_maps_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "network_maps" ADD CONSTRAINT "network_maps_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "route_studies" ADD CONSTRAINT "route_studies_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "route_studies" ADD CONSTRAINT "route_studies_opportunity_id_opportunities_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."opportunities"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "route_studies" ADD CONSTRAINT "route_studies_network_map_id_network_maps_id_fk" FOREIGN KEY ("network_map_id") REFERENCES "public"."network_maps"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "route_studies" ADD CONSTRAINT "route_studies_attachment_id_opportunity_attachments_id_fk" FOREIGN KEY ("attachment_id") REFERENCES "public"."opportunity_attachments"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "route_studies" ADD CONSTRAINT "route_studies_glpi_ticket_id_glpi_tickets_id_fk" FOREIGN KEY ("glpi_ticket_id") REFERENCES "public"."glpi_tickets"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "route_studies" ADD CONSTRAINT "route_studies_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "network_maps_tenant_idx" ON "network_maps" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "route_studies_opp_idx" ON "route_studies" USING btree ("tenant_id","opportunity_id","created_at");