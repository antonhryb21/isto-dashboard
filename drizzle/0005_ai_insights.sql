CREATE TABLE "ai_insights" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"trigger" text NOT NULL,
	"requested_by" text,
	"model" text NOT NULL,
	"period_from" date NOT NULL,
	"period_to" date NOT NULL,
	"health" integer,
	"summary" text,
	"insights" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"snapshot" jsonb,
	"input_tokens" integer,
	"output_tokens" integer,
	"error" text
);
--> statement-breakpoint
CREATE INDEX "ai_insights_created_idx" ON "ai_insights" USING btree ("created_at");