import { NextResponse, type NextRequest } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { addComment, leadByMetaId, setLeadFields } from "@/lib/leads";
import { ingestLead } from "@/lib/meta/leadgen";
import { parseStatus, STATUS_BY_CODE } from "@/lib/statuses";
import { syncTelegramCards } from "@/lib/telegram-cards";

/**
 * Status change from the Telegram bot (n8n).
 *
 * POST /api/leads/status
 * Authorization: Bearer <LEADS_API_TOKEN>
 * { "lead_id": "1977622026500180", "status": "Contacted", "changed_by": "@yuliia", "owner": "Max", "comment": "…" }
 *
 * lead_id is the Meta leadgen id (with or without the "l:" prefix). status accepts a label
 * ("Follow-up"), a code ("follow_up") or a known alias. owner and comment are optional.
 * chat_id + message_id (optional) name the card the button was pressed on: the bot edits that one
 * itself, the dashboard updates the lead's other cards (group / personal chat).
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
    chat_id?: unknown;
    message_id?: unknown;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "body must be JSON" }, { status: 400 });
  }

  const leadId = String(body.lead_id ?? "").trim().replace(/^l:/, "");
  if (!/^\d{5,25}$/.test(leadId)) return NextResponse.json({ ok: false, error: "lead_id must be the Meta lead id" }, { status: 400 });

  const status = body.status === undefined || body.status === null || body.status === "" ? null : parseStatus(String(body.status));
  if (body.status && !status) {
    return NextResponse.json(
      { ok: false, error: `unknown status "${body.status}"`, allowed: Object.values(STATUS_BY_CODE).map((s) => s.label) },
      { status: 400 },
    );
  }
  const author = `telegram:${String(body.changed_by ?? "bot").slice(0, 60)}`;

  // The button can be pressed before our own webhook stored the lead; fetch it from Meta then.
  let lead = await leadByMetaId(leadId);
  if (!lead) {
    try {
      await ingestLead(leadId);
      lead = await leadByMetaId(leadId);
    } catch (e) {
      return NextResponse.json({ ok: false, error: `lead not found: ${e instanceof Error ? e.message : e}` }, { status: 404 });
    }
  }
  if (!lead) return NextResponse.json({ ok: false, error: "lead not found" }, { status: 404 });

  const { events } = await setLeadFields(lead.id, author, {
    status: status ?? undefined,
    owner: body.owner === undefined ? undefined : String(body.owner ?? "").trim() || null,
  });
  const comment = String(body.comment ?? "").trim();
  if (comment) await addComment(lead.id, author, comment.slice(0, 4000));

  let cards: unknown;
  if (events.some((e) => e.type === "status")) {
    const skip =
      body.chat_id !== undefined && Number.isInteger(Number(body.message_id))
        ? { chatId: String(body.chat_id), messageId: Number(body.message_id) }
        : undefined;
    try {
      cards = await syncTelegramCards(lead.id, skip);
    } catch (e) {
      cards = { error: e instanceof Error ? e.message : String(e) };
    }
  }

  return NextResponse.json({ ok: true, lead: lead.id, status: status ?? lead.status, ...(cards ? { cards } : {}) });
}
