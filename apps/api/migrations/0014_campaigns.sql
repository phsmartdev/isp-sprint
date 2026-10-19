CREATE TABLE IF NOT EXISTS "campaign_costs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"campaign_id" uuid NOT NULL,
	"spent_on" date NOT NULL,
	"category" text NOT NULL,
	"description" text NOT NULL,
	"amount_cents" bigint NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "objective" text;--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "audience" text;--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "offer" text;--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "message" text;--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "channels" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "notes" text;--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "owner_id" uuid;--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "budget_cents" bigint;--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "target_leads" integer;--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "target_sales" integer;--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "campaign_costs" ADD CONSTRAINT "campaign_costs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "campaign_costs" ADD CONSTRAINT "campaign_costs_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "campaign_costs" ADD CONSTRAINT "campaign_costs_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "campaign_costs_campaign_idx" ON "campaign_costs" USING btree ("tenant_id","campaign_id");--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
