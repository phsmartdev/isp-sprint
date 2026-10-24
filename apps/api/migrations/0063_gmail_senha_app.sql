ALTER TABLE "mailboxes" ADD COLUMN "provider" text DEFAULT 'gmail_api' NOT NULL;--> statement-breakpoint
ALTER TABLE "mailboxes" ADD COLUMN "app_password_enc" text;