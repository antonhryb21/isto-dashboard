CREATE TABLE "lead_telegram_cards" (
	"chat_id" text NOT NULL,
	"message_id" integer NOT NULL,
	"meta_lead_id" text NOT NULL,
	"base_text" text NOT NULL,
	"reply_markup" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lead_telegram_cards_chat_id_message_id_pk" PRIMARY KEY("chat_id","message_id")
);
--> statement-breakpoint
CREATE INDEX "lead_tg_cards_lead_idx" ON "lead_telegram_cards" USING btree ("meta_lead_id");