ALTER TABLE "opportunity_attachments" DROP CONSTRAINT "opp_attach_kind_ck";--> statement-breakpoint
ALTER TABLE "opportunities" ADD COLUMN "origin_mail_thread_id" uuid;--> statement-breakpoint
ALTER TABLE "opportunity_attachments" ADD CONSTRAINT "opp_attach_kind_ck" CHECK (kind in ('proposta','outro','email'));