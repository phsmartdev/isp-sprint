CREATE TABLE IF NOT EXISTS "user_feed_clears" (
	"tenant_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"scope" text NOT NULL,
	"cleared_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_feed_clears_user_id_scope_pk" PRIMARY KEY("user_id","scope"),
	CONSTRAINT "user_feed_clears_scope_ck" CHECK (scope in ('sino','mencoes'))
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "user_feed_clears" ADD CONSTRAINT "user_feed_clears_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "user_feed_clears" ADD CONSTRAINT "user_feed_clears_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
