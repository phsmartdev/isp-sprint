ALTER TABLE "mail_signatures" ADD COLUMN "image_mime" text;--> statement-breakpoint
ALTER TABLE "mail_signatures" ADD COLUMN "image_data" "bytea";--> statement-breakpoint
ALTER TABLE "mail_signatures" ADD COLUMN "image_width" integer;