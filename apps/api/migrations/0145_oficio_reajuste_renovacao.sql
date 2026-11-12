ALTER TABLE "contracts" ADD COLUMN "renewal_clause" text;--> statement-breakpoint
ALTER TABLE "office_letters" ADD COLUMN "adjustment" jsonb;--> statement-breakpoint
ALTER TABLE "office_letters" ADD COLUMN "renewal" jsonb;--> statement-breakpoint
ALTER TABLE "office_letters" ADD COLUMN "sent_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "office_letters" ADD COLUMN "sent_to" text;