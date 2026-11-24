CREATE TABLE "ig_conversations" (
	"id" text PRIMARY KEY NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"from_content" boolean DEFAULT false NOT NULL,
	"partial" boolean DEFAULT false NOT NULL,
	"seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
