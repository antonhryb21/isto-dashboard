CREATE TABLE "deleted_leads" (
	"meta_lead_id" text PRIMARY KEY NOT NULL,
	"full_name" text,
	"deleted_by" text NOT NULL,
	"deleted_at" timestamp with time zone DEFAULT now() NOT NULL
);
