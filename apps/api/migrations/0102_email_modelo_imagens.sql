CREATE TABLE IF NOT EXISTS "comm_assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"filename" text NOT NULL,
	"mime" text NOT NULL,
	"data" "bytea" NOT NULL,
	"width" integer,
	"height" integer,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "comm_assets_kind_ck" CHECK (kind in ('cabecalho','rodape'))
);
--> statement-breakpoint
ALTER TABLE "comm_template_versions" ADD COLUMN "header_asset_id" uuid;--> statement-breakpoint
ALTER TABLE "comm_template_versions" ADD COLUMN "footer_asset_id" uuid;--> statement-breakpoint
ALTER TABLE "comm_template_versions" ADD COLUMN "frame_height" integer DEFAULT 320 NOT NULL;--> statement-breakpoint
ALTER TABLE "comm_templates" ADD COLUMN "header_asset_id" uuid;--> statement-breakpoint
ALTER TABLE "comm_templates" ADD COLUMN "footer_asset_id" uuid;--> statement-breakpoint
ALTER TABLE "comm_templates" ADD COLUMN "frame_height" integer DEFAULT 320 NOT NULL;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "comm_assets" ADD CONSTRAINT "comm_assets_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "comm_assets" ADD CONSTRAINT "comm_assets_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "comm_assets_idx" ON "comm_assets" USING btree ("tenant_id");--> statement-breakpoint
CREATE TRIGGER comm_assets_append_only BEFORE UPDATE OR DELETE ON comm_assets
  FOR EACH ROW EXECUTE FUNCTION isp_forbid_mutation();
