import { NextResponse, type NextRequest } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { registerTelegramCard } from "@/lib/telegram-cards";

/**
 * The lead bot (n8n) tells the dashboard about a card it has just posted, so that a status
 * changed later in the CRM can be written into that card.
 *
 * POST /api/leads/telegram-card
 * Authorization: Bearer <LEADS_API_TOKEN>
 * { "lead_id": "l:1977622026500180", "chat_id": "-5398273801", "message_id": 178,
 *   "text": "<card text as sent, HTML>", "reply_markup": { "inline_keyboard": [...] } }
 *
 * The lead does not have to be in the CRM yet. Sending the same card again changes nothing.
 */
export async function POST(request: NextRequest) {
  const token = process.env.LEADS_API_TOKEN ?? "";
  const given = (request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!token || given.length !== token.length || !timingSafeEqual(Buffer.from(given), Buffer.from(token))) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  let body: { lead_id?: unknown; chat_id?: unknown; message_id?: unknown; text?: unknown; reply_markup?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "body must be JSON" }, { status: 400 });
  }

  const leadId = String(body.lead_id ?? "").trim().replace(/^l:/, "");
  if (!/^\d{5,25}$/.test(leadId)) return NextResponse.json({ ok: false, error: "lead_id must be the Meta lead id" }, { status: 400 });
  const chatId = String(body.chat_id ?? "").trim();
  const messageId = Number(body.message_id);
  if (!/^-?\d+$/.test(chatId) || !Number.isInteger(messageId)) {
    return NextResponse.json({ ok: false, error: "chat_id and message_id are required" }, { status: 400 });
  }
  if (typeof body.text !== "string" || !body.text.trim()) return NextResponse.json({ ok: false, error: "text is required" }, { status: 400 });

  await registerTelegramCard({ metaLeadId: leadId, chatId, messageId, text: body.text, replyMarkup: body.reply_markup });
  return NextResponse.json({ ok: true });
}
