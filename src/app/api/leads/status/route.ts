import { after, NextResponse, type NextRequest } from "next/server";
import { sendLeadStage } from "@/lib/meta/crm-events";
import { timingSafeEqual } from "node:crypto";
import { addComment, leadById, leadByMetaId, setLeadFields } from "@/lib/leads";
import { parseBotLeadId } from "@/lib/lead-source";
import { ingestLead } from "@/lib/meta/leadgen";
import { parseStatus, STATUS_BY_CODE } from "@/lib/statuses";
import { cardTextFor, registerTelegramCard, syncTelegramCards } from "@/lib/telegram-cards";

/**
 * Status change from the Telegram bot (n8n).
 *
 * POST /api/leads/status
 * Authorization: Bearer <LEADS_API_TOKEN>
 * { "lead_id": "1977622026500180", "status": "Contacted", "changed_by": "@yuliia", "owner": "Max", "comment": "…",
 *   "next_contact": "2026-11-20", "lost_reason": "Задорого" }
 *
 * Every field but lead_id is optional: { "lead_id", "comment", "changed_by" } alone is the bot's Comment button.
 * A comment goes into the lead's history and onto all of its Telegram cards.
 *
 * lead_id is the Meta leadgen id (with or without the "l:" prefix), or "w:<CRM id>" for a website
 * form lead. status accepts a label
 * ("No answer"), a code ("no_answer") or a known alias. owner and comment are optional.
 *
 * Optional, the card the button was pressed on: "chat_id", "message_id", "card_text", "reply_markup".
 * The bot edits that card itself; the dashboard remembers it and rewrites the lead's other cards
 * (group / personal chat) with the new status. The answer then has "card_text": the full text for the
 * pressed card with every status and comment block, so the bot can put exactly that on it.
 */
export async function POST(request: NextRequest) {
  const token = process.env.LEADS_API_TOKEN ?? "";
  const given = (request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!token || given.length !== token.length || !timingSafeEqual(Buffer.from(given), Buffer.from(token))) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  let body: {
    lead_id?: unknown;
    status?: unknown;
    changed_by?: unknown;
    owner?: unknown;
    comment?: unknown;
    next_contact?: unknown;
    lost_reason?: unknown;
    chat_id?: unknown;
    message_id?: unknown;
    card_text?: unknown;
    reply_markup?: unknown;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "body must be JSON" }, { status: 400 });
  }

  const ref = parseBotLeadId(body.lead_id);
  if (!ref) return NextResponse.json({ ok: false, error: "lead_id must be the Meta lead id or w:<CRM id>" }, { status: 400 });

  const status = body.status === undefined || body.status === null || body.status === "" ? null : parseStatus(String(body.status));
  if (body.status && !status) {
    return NextResponse.json(
      { ok: false, error: `unknown status "${body.status}"`, allowed: Object.values(STATUS_BY_CODE).map((s) => s.label) },
      { status: 400 },
    );
  }
  const next = body.next_contact === undefined ? undefined : String(body.next_contact ?? "").trim() || null;
  if (next && !/^\d{4}-\d{2}-\d{2}$/.test(next)) return NextResponse.json({ ok: false, error: "next_contact must be YYYY-MM-DD" }, { status: 400 });
  const author = `telegram:${String(body.changed_by ?? "bot").slice(0, 60)}`;

  // The button can be pressed before our own webhook stored the lead; fetch it from Meta then.
  let lead = ref.kind === "crm" ? await leadById(ref.id) : await leadByMetaId(ref.id);
  if (!lead && ref.kind === "meta") {
    const leadId = ref.id;
    try {
      await ingestLead(leadId);
      lead = await leadByMetaId(leadId);
    } catch (e) {
      return NextResponse.json({ ok: false, error: `lead not found: ${e instanceof Error ? e.message : e}` }, { status: 404 });
    }
  }
  if (!lead) return NextResponse.json({ ok: false, error: "lead not found" }, { status: 404 });
  // Cards are stored under the lead's own key: the Meta id, or "web:…" for a website lead.
  const cardKey = lead.metaLeadId ?? (ref.kind === "meta" ? ref.id : "");

  await setLeadFields(lead.id, author, {
    status: status ?? undefined,
    owner: body.owner === undefined ? undefined : String(body.owner ?? "").trim() || null,
    nextContactAt: next,
    lostReason: body.lost_reason === undefined ? undefined : String(body.lost_reason ?? "").trim().slice(0, 200) || null,
  });
  // The card the button was pressed on: remember it (cards posted before this feature are
  // learned this way) and leave it to the bot, which has already edited it.
  const chatId = body.chat_id === undefined || body.chat_id === null ? "" : String(body.chat_id).trim();
  const messageId = Number(body.message_id);
  const pressed = /^-?\d+$/.test(chatId) && Number.isInteger(messageId) ? { chatId, messageId } : undefined;
  if (pressed && cardKey && typeof body.card_text === "string" && body.card_text.trim()) {
    await registerTelegramCard({ metaLeadId: cardKey, ...pressed, text: body.card_text, replyMarkup: body.reply_markup });
  }

  const comment = String(body.comment ?? "").trim();
  if (comment) await addComment(lead.id, author, comment.slice(0, 4000));

  const statusChanged = !!status && status !== lead.status;
  if (statusChanged) {
    const metaId = lead.metaLeadId;
    after(() => sendLeadStage(metaId, status));
  }
  // The lead's other cards (group / personal chat) get the new status or comment block.
  if (statusChanged || comment) {
    const id = lead.id;
    after(() => syncTelegramCards(id, pressed));
  }

  const cardText = pressed && cardKey ? await cardTextFor(lead.id, cardKey, pressed.chatId, pressed.messageId) : null;
  return NextResponse.json({ ok: true, lead: lead.id, status: status ?? lead.status, ...(cardText ? { card_text: cardText } : {}) });
}
