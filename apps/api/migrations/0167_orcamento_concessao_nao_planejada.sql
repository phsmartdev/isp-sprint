ALTER TABLE "budget_lines" ADD COLUMN "origin" text;--> statement-breakpoint
ALTER TABLE "budget_lines" ADD COLUMN "gift_request_id" uuid;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "budget_lines" ADD CONSTRAINT "budget_lines_gift_request_id_gift_requests_id_fk" FOREIGN KEY ("gift_request_id") REFERENCES "public"."gift_requests"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
