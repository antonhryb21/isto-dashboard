CREATE TABLE "targets" (
	"month" date NOT NULL,
	"region_code" text NOT NULL,
	"budget" numeric(14, 2),
	"leads" integer,
	"qualified" integer,
	"deals" integer,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "targets_month_region_code_pk" PRIMARY KEY("month","region_code")
);
