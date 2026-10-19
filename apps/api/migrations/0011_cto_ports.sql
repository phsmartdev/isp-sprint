ALTER TABLE "condominiums" ADD COLUMN "cto_ports" integer;--> statement-breakpoint
ALTER TABLE "opportunities" ADD COLUMN "port_released_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "opportunities" ADD COLUMN "port_release_reason" text;