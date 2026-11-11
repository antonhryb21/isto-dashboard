ALTER TABLE "leads" ADD COLUMN "next_contact_at" date;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "lost_reason" text;--> statement-breakpoint
ALTER TABLE "regions" ADD COLUMN "default_owner" text;