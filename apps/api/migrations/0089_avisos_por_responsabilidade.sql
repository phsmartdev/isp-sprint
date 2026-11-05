CREATE TABLE IF NOT EXISTS "contract_external_actors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"organization" text,
	"email" text,
	"whatsapp" text,
	"channels" text[] DEFAULT '{}'::text[] NOT NULL,
	"roles" text[] DEFAULT '{}'::text[] NOT NULL,
	"notes" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "contract_notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"contract_id" uuid,
	"activity_id" uuid,
	"event" text NOT NULL,
	"raci_letter" text,
	"role" text,
	"user_id" uuid,
	"actor_id" uuid,
	"recipient_name" text NOT NULL,
	"channel" text NOT NULL,
	"to_address" text,
	"status" text NOT NULL,
	"error" text,
	"token" text NOT NULL,
	"dedupe_key" text NOT NULL,
	"title" text NOT NULL,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL,
	"confirmed_at" timestamp with time zone,
	"confirm_ip" text,
	"response_text" text,
	"responded_at" timestamp with time zone,
	CONSTRAINT "contract_notifications_channel_ck" CHECK (channel in ('email','whatsapp')),
	CONSTRAINT "contract_notifications_status_ck" CHECK (status in ('enviado','falhou','nao_configurado','sem_contato'))
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "playbook_roles" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "contract_external_actors" ADD CONSTRAINT "contract_external_actors_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "contract_external_actors" ADD CONSTRAINT "contract_external_actors_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "contract_notifications" ADD CONSTRAINT "contract_notifications_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "contract_notifications" ADD CONSTRAINT "contract_notifications_contract_id_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."contracts"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "contract_notifications" ADD CONSTRAINT "contract_notifications_activity_id_activities_id_fk" FOREIGN KEY ("activity_id") REFERENCES "public"."activities"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "contract_notifications" ADD CONSTRAINT "contract_notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "contract_notifications" ADD CONSTRAINT "contract_notifications_actor_id_contract_external_actors_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."contract_external_actors"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "contract_external_actors_idx" ON "contract_external_actors" USING btree ("tenant_id","active");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "contract_notifications_token_uq" ON "contract_notifications" USING btree ("token");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "contract_notifications_dedupe_uq" ON "contract_notifications" USING btree ("tenant_id","dedupe_key");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "contract_notifications_act_idx" ON "contract_notifications" USING btree ("tenant_id","activity_id");--> statement-breakpoint
-- papéis passam a ser do cadastro do usuário: leva os titulares já definidos (sem perder nada)
UPDATE "users" u SET "playbook_roles" = x.roles FROM (
  SELECT user_id, array_agg(DISTINCT role ORDER BY role) AS roles FROM "playbook_role_holders" WHERE user_id IS NOT NULL GROUP BY user_id
) x WHERE u.id = x.user_id;
--> statement-breakpoint
INSERT INTO "contract_external_actors" ("tenant_id", "name", "roles", "created_by")
SELECT tenant_id, external_name, array_agg(DISTINCT role ORDER BY role), (array_agg(created_by))[1]
FROM "playbook_role_holders" WHERE external_name IS NOT NULL GROUP BY tenant_id, external_name;
