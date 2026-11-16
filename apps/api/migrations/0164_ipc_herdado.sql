ALTER TABLE "account_relations" ADD COLUMN "ipc_follower_id" uuid;--> statement-breakpoint
ALTER TABLE "structure_members" ADD COLUMN "inherits_ipc" boolean DEFAULT false NOT NULL;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "account_relations" ADD CONSTRAINT "account_relations_ipc_follower_id_contacts_id_fk" FOREIGN KEY ("ipc_follower_id") REFERENCES "public"."contacts"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
