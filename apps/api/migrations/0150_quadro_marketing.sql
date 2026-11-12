CREATE TABLE IF NOT EXISTS "mkt_card_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"card_id" uuid NOT NULL,
	"type" text NOT NULL,
	"text" text,
	"actor_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "mkt_card_tags" (
	"tenant_id" uuid NOT NULL,
	"card_id" uuid NOT NULL,
	"tag_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "mkt_cards" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"code" integer NOT NULL,
	"title" text NOT NULL,
	"briefing" text,
	"column" text DEFAULT 'backlog' NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"owner_id" uuid NOT NULL,
	"observer_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"due_on" date,
	"priority" text DEFAULT 'media' NOT NULL,
	"verticals" text[] DEFAULT '{}'::text[] NOT NULL,
	"allocation" text,
	"requester" text,
	"sprint_id" uuid,
	"fura_fila" boolean DEFAULT false NOT NULL,
	"fura_fila_status" text,
	"fura_fila_criterion" text,
	"fura_fila_reason" text,
	"fura_fila_decided_by" uuid,
	"fura_fila_decided_at" timestamp with time zone,
	"cost_center_id" uuid,
	"budget_line_id" uuid,
	"budget_cents" integer,
	"gifts" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"completed_at" timestamp with time zone,
	"archived_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"row_version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "mkt_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"tag_id" uuid,
	"card_id" uuid,
	"entity_type" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"label" text NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "mkt_sprints" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"start_on" date NOT NULL,
	"end_on" date NOT NULL,
	"objective" text,
	"highlights" text,
	"status" text DEFAULT 'planejamento' NOT NULL,
	"opened_at" timestamp with time zone,
	"opened_by" uuid,
	"closed_at" timestamp with time zone,
	"closed_by" uuid,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "mkt_tags" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"color" text DEFAULT '#2F5986' NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "mkt_card_events" ADD CONSTRAINT "mkt_card_events_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "mkt_card_events" ADD CONSTRAINT "mkt_card_events_card_id_mkt_cards_id_fk" FOREIGN KEY ("card_id") REFERENCES "public"."mkt_cards"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "mkt_card_events" ADD CONSTRAINT "mkt_card_events_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "mkt_card_tags" ADD CONSTRAINT "mkt_card_tags_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "mkt_card_tags" ADD CONSTRAINT "mkt_card_tags_card_id_mkt_cards_id_fk" FOREIGN KEY ("card_id") REFERENCES "public"."mkt_cards"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "mkt_card_tags" ADD CONSTRAINT "mkt_card_tags_tag_id_mkt_tags_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."mkt_tags"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "mkt_cards" ADD CONSTRAINT "mkt_cards_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "mkt_cards" ADD CONSTRAINT "mkt_cards_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "mkt_cards" ADD CONSTRAINT "mkt_cards_sprint_id_mkt_sprints_id_fk" FOREIGN KEY ("sprint_id") REFERENCES "public"."mkt_sprints"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "mkt_cards" ADD CONSTRAINT "mkt_cards_fura_fila_decided_by_users_id_fk" FOREIGN KEY ("fura_fila_decided_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "mkt_cards" ADD CONSTRAINT "mkt_cards_cost_center_id_cost_centers_id_fk" FOREIGN KEY ("cost_center_id") REFERENCES "public"."cost_centers"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "mkt_cards" ADD CONSTRAINT "mkt_cards_budget_line_id_budget_lines_id_fk" FOREIGN KEY ("budget_line_id") REFERENCES "public"."budget_lines"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "mkt_cards" ADD CONSTRAINT "mkt_cards_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "mkt_links" ADD CONSTRAINT "mkt_links_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "mkt_links" ADD CONSTRAINT "mkt_links_tag_id_mkt_tags_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."mkt_tags"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "mkt_links" ADD CONSTRAINT "mkt_links_card_id_mkt_cards_id_fk" FOREIGN KEY ("card_id") REFERENCES "public"."mkt_cards"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "mkt_links" ADD CONSTRAINT "mkt_links_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "mkt_sprints" ADD CONSTRAINT "mkt_sprints_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "mkt_sprints" ADD CONSTRAINT "mkt_sprints_opened_by_users_id_fk" FOREIGN KEY ("opened_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "mkt_sprints" ADD CONSTRAINT "mkt_sprints_closed_by_users_id_fk" FOREIGN KEY ("closed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "mkt_sprints" ADD CONSTRAINT "mkt_sprints_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "mkt_tags" ADD CONSTRAINT "mkt_tags_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "mkt_tags" ADD CONSTRAINT "mkt_tags_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "mkt_card_events_idx" ON "mkt_card_events" USING btree ("card_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "mkt_card_tags_pk" ON "mkt_card_tags" USING btree ("card_id","tag_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "mkt_cards_idx" ON "mkt_cards" USING btree ("tenant_id","column","position");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "mkt_cards_code_uq" ON "mkt_cards" USING btree ("tenant_id","code");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "mkt_links_entity_idx" ON "mkt_links" USING btree ("tenant_id","entity_type","entity_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "mkt_links_tag_uq" ON "mkt_links" USING btree ("tag_id","entity_type","entity_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "mkt_links_card_uq" ON "mkt_links" USING btree ("card_id","entity_type","entity_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "mkt_sprints_idx" ON "mkt_sprints" USING btree ("tenant_id","start_on");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "mkt_tags_uq" ON "mkt_tags" USING btree ("tenant_id","name");