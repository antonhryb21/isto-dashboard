CREATE TABLE "competitor_posts" (
	"id" text PRIMARY KEY NOT NULL,
	"username" text NOT NULL,
	"content_type" text NOT NULL,
	"caption" text,
	"media_url" text,
	"thumbnail_url" text,
	"permalink" text,
	"published_at" timestamp with time zone NOT NULL,
	"likes" integer,
	"comments" integer,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "competitor_snapshots" (
	"username" text NOT NULL,
	"date" date NOT NULL,
	"followers" integer,
	"media_count" integer,
	CONSTRAINT "competitor_snapshots_username_date_pk" PRIMARY KEY("username","date")
);
--> statement-breakpoint
CREATE TABLE "competitors" (
	"username" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"is_own" boolean DEFAULT false NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 100 NOT NULL,
	"ad_library_page_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"ig_id" text,
	"display_name" text,
	"biography" text,
	"website" text,
	"profile_picture_url" text,
	"followers" integer,
	"media_count" integer,
	"last_synced_at" timestamp with time zone,
	"last_error" text
);
--> statement-breakpoint
CREATE INDEX "competitor_posts_user_idx" ON "competitor_posts" USING btree ("username","published_at");