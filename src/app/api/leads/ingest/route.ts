import { NextResponse, type NextRequest } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { leadByMetaId, upsertLead } from "@/lib/leads";
import { ingestLead } from "@/lib/meta/leadgen";
import { detectRegion, listRegions } from "@/lib/regions";
import { registerTelegramCard } from "@/lib/telegram-cards";

/**
 * New lead from the Telegram bot (n8n), sent right after the bot posted the card.
 *
 * POST /api/leads/ingest
 * Authorization: Bearer <LEADS_API_TOKEN>
 * {
 *   "lead_id": "1977622026500180",                // Meta leadgen id, with or without "l:"
 *   "lead": { "full_name", "phone", "email", "city", "form_id", "form_name", "created_time", "answers": {} },  // optional
 *   "telegram": { "chat_id": "-100…", "message_id": 123, "text": "<card html>", "reply_markup": {…} }       // optional
 * }
 *
 * The lead is fetched from Meta (full ad attribution). If Meta can't be reached, the data in
 * `lead` is stored instead. Sending the same lead again is harmless.
 */
export async function POST(request: NextRequest) {
  const token = process.env.LEADS_API_TOKEN ?? "";
  const given = (request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!token || given.length !== token.length || !timingSafeEqual(Buffer.from(given), Buffer.from(token))) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  type Body = {
    lead_id?: unknown;
    lead?: {
      full_name?: string;
      phone?: string;
      email?: string;
      city?: string;
      form_id?: string;
      form_name?: string;
      created_time?: string;
      answers?: Record<string, unknown>;
    };
    telegram?: { chat_id?: unknown; message_id?: unknown; text?: unknown; reply_markup?: unknown };
  };
  let body: Body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "body must be JSON" }, { status: 400 });
  }

  const leadId = String(body.lead_id ?? "").trim().replace(/^l:/, "");
  if (!/^\d{5,25}$/.test(leadId)) return NextResponse.json({ ok: false, error: "lead_id must be the Meta lead id" }, { status: 400 });

  let source: "existing" | "meta" | "payload" = "existing";
  let warning: string | undefined;
  let lead = await leadByMetaId(leadId);
  if (!lead) {
    try {
      await ingestLead(leadId);
      source = "meta";
    } catch (e) {
      warning = `Meta: ${e instanceof Error ? e.message : e}`;
      const l = body.lead;
      if (!l) return NextResponse.json({ ok: false, error: `lead not found and no data sent (${warning})` }, { status: 404 });
      const str = (v: unknown) => (v === undefined || v === null || String(v).trim() === "" ? null : String(v).trim());
      const created = l.created_time ? new Date(l.created_time) : new Date();
      await upsertLead(
        {
          metaLeadId: leadId,
          createdTime: Number.isNaN(created.getTime()) ? new Date() : created,
          regionCode: detectRegion(await listRegions(), null, null, l.form_name ?? null),
          platform: null,
          isOrganic: false,
          campaignId: null,
          campaignName: null,
          adsetId: null,
          adsetName: null,
          adId: null,
          adName: null,
          formId: str(l.form_id),
          formName: str(l.form_name),
          fullName: str(l.full_name),
          phone: str(l.phone)?.replace(/^p:/, "") ?? null,
          email: str(l.email),
          city: str(l.city),
          answers: Object.fromEntries(Object.entries(l.answers ?? {}).map(([k, v]) => [k, String(v ?? "")])),
        },
        "meta",
      );
      source = "payload";
    }
    lead = await leadByMetaId(leadId);
  }
  if (!lead) return NextResponse.json({ ok: false, error: "lead could not be stored" }, { status: 500 });

  const tg = body.telegram;
  const messageId = Number(tg?.message_id);
  if (tg && tg.chat_id !== undefined && Number.isInteger(messageId) && typeof tg.text === "string" && tg.text) {
    await registerTelegramCard({
      leadId: lead.id,
      chatId: String(tg.chat_id),
      messageId,
      baseText: tg.text,
      replyMarkup: tg.reply_markup ?? null,
    });
  }

  return NextResponse.json({ ok: true, lead: lead.id, source, ...(warning ? { warning } : {}) });
}
