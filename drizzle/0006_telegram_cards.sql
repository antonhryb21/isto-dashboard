CREATE TABLE "lead_telegram_messages" (
	"lead_id" uuid NOT NULL,
	"chat_id" text NOT NULL,
	"message_id" integer NOT NULL,
	"base_text" text NOT NULL,
	"reply_markup" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lead_telegram_messages_chat_id_message_id_pk" PRIMARY KEY("chat_id","message_id")
);
--> statement-breakpoint
ALTER TABLE "lead_telegram_messages" ADD CONSTRAINT "lead_telegram_messages_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "lead_tg_lead_idx" ON "lead_telegram_messages" USING btree ("lead_id");