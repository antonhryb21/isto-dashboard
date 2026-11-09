ALTER TABLE "account_snapshots" ADD COLUMN "new_followers" integer;--> statement-breakpoint
ALTER TABLE "ad_insights_daily" ADD COLUMN "page_engagement" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "ad_insights_daily" ADD COLUMN "post_reactions" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "ad_insights_daily" ADD COLUMN "post_comments" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "ad_insights_daily" ADD COLUMN "post_saves" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "ad_insights_daily" ADD COLUMN "post_shares" integer DEFAULT 0 NOT NULL;