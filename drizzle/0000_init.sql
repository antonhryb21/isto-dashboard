CREATE TYPE "public"."role" AS ENUM('admin', 'marketing', 'viewer');--> statement-breakpoint
CREATE TABLE "account_snapshots" (
	"platform" text NOT NULL,
	"account_id" text NOT NULL,
	"date" date NOT NULL,
	"followers" integer,
	"media_count" integer,
	CONSTRAINT "account_snapshots_platform_account_id_date_pk" PRIMARY KEY("platform","account_id","date")
);
--> statement-breakpoint
CREATE TABLE "ad_insights_daily" (
	"date" date NOT NULL,
	"ad_id" text NOT NULL,
	"account_id" text NOT NULL,
	"campaign_id" text,
	"adset_id" text,
	"currency" text,
	"spend" numeric(14, 2) DEFAULT '0' NOT NULL,
	"impressions" integer DEFAULT 0 NOT NULL,
	"reach" integer DEFAULT 0 NOT NULL,
	"clicks" integer DEFAULT 0 NOT NULL,
	"link_clicks" integer DEFAULT 0 NOT NULL,
	"leads" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ad_insights_daily_date_ad_id_pk" PRIMARY KEY("date","ad_id")
);
--> statement-breakpoint
CREATE TABLE "ads" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"campaign_id" text,
	"adset_id" text,
	"adset_name" text,
	"name" text NOT NULL,
	"status" text,
	"created_time" timestamp with time zone,
	"creative_id" text,
	"thumbnail_url" text,
	"image_url" text,
	"video_id" text,
	"body" text,
	"title" text,
	"object_type" text,
	"instagram_media_id" text,
	"page_post_id" text,
	"permalink" text,
	"preview_link" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "campaigns" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"name" text NOT NULL,
	"objective" text,
	"status" text,
	"region_code" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lead_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lead_id" uuid NOT NULL,
	"type" text NOT NULL,
	"from_value" text,
	"to_value" text,
	"text" text,
	"author" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lead_sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"spreadsheet_id" text NOT NULL,
	"sheet_name" text NOT NULL,
	"region_code" text,
	"enabled" boolean DEFAULT true NOT NULL,
	"history_sheet_name" text,
	"last_synced_at" timestamp with time zone,
	"last_error" text
);
--> statement-breakpoint
CREATE TABLE "leads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"meta_lead_id" text,
	"source_id" uuid,
	"sheet_row" integer,
	"created_time" timestamp with time zone NOT NULL,
	"region_code" text,
	"platform" text,
	"is_organic" boolean DEFAULT false NOT NULL,
	"campaign_id" text,
	"campaign_name" text,
	"adset_id" text,
	"adset_name" text,
	"ad_id" text,
	"ad_name" text,
	"form_id" text,
	"form_name" text,
	"full_name" text,
	"phone" text,
	"email" text,
	"city" text,
	"answers" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'new' NOT NULL,
	"status_raw" text,
	"status_updated_at" timestamp with time zone,
	"owner" text,
	"deal_amount" numeric(14, 2),
	"deal_currency" text,
	"first_contact_at" timestamp with time zone,
	"sheet_comment" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "regions" (
	"code" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"keywords" text[] DEFAULT '{}' NOT NULL,
	"currency" text DEFAULT 'AED' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "social_post_snapshots" (
	"post_id" text NOT NULL,
	"date" date NOT NULL,
	"metrics" jsonb NOT NULL,
	CONSTRAINT "social_post_snapshots_post_id_date_pk" PRIMARY KEY("post_id","date")
);
--> statement-breakpoint
CREATE TABLE "social_posts" (
	"id" text PRIMARY KEY NOT NULL,
	"platform" text NOT NULL,
	"account_id" text NOT NULL,
	"content_type" text NOT NULL,
	"caption" text,
	"media_url" text,
	"thumbnail_url" text,
	"permalink" text,
	"published_at" timestamp with time zone NOT NULL,
	"likes" integer,
	"comments" integer,
	"saves" integer,
	"shares" integer,
	"reach" integer,
	"views" integer,
	"profile_visits" integer,
	"follows" integer,
	"total_interactions" integer,
	"boosted" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sync_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"ok" boolean,
	"message" text
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"name" text,
	"role" "role" DEFAULT 'viewer' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_login_at" timestamp with time zone,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "lead_events" ADD CONSTRAINT "lead_events_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_sources" ADD CONSTRAINT "lead_sources_region_code_regions_code_fk" FOREIGN KEY ("region_code") REFERENCES "public"."regions"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_source_id_lead_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."lead_sources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ins_campaign_idx" ON "ad_insights_daily" USING btree ("campaign_id","date");--> statement-breakpoint
CREATE INDEX "ads_campaign_idx" ON "ads" USING btree ("campaign_id");--> statement-breakpoint
CREATE INDEX "ads_igmedia_idx" ON "ads" USING btree ("instagram_media_id");--> statement-breakpoint
CREATE INDEX "lead_events_lead_idx" ON "lead_events" USING btree ("lead_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "lead_sources_sheet_uq" ON "lead_sources" USING btree ("spreadsheet_id","sheet_name");--> statement-breakpoint
CREATE UNIQUE INDEX "leads_meta_lead_uq" ON "leads" USING btree ("meta_lead_id");--> statement-breakpoint
CREATE INDEX "leads_created_idx" ON "leads" USING btree ("created_time");--> statement-breakpoint
CREATE INDEX "leads_status_idx" ON "leads" USING btree ("status");--> statement-breakpoint
CREATE INDEX "leads_ad_idx" ON "leads" USING btree ("ad_id");--> statement-breakpoint
CREATE INDEX "social_published_idx" ON "social_posts" USING btree ("platform","published_at");