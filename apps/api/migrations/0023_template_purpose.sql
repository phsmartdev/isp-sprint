ALTER TABLE "proposal_templates" ADD COLUMN "purpose" text DEFAULT 'proposta' NOT NULL;--> statement-breakpoint
ALTER TABLE "proposal_templates" ADD COLUMN "billing_type" text;