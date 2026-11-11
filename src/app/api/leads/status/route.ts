import { NextResponse, type NextRequest } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { addComment, leadByMetaId, setLeadFields } from "@/lib/leads";
import { ingestLead } from "@/lib/meta/leadgen";
import { parseStatus, STATUS_BY_CODE } from "@/lib/statuses";

/**
 * Status change from the Telegram bot (n8n).
 *
 * POST /api/leads/status
 * Authorization: Bearer <LEADS_API_TOKEN>
 * { "lead_id": "1977622026500180", "status": "Contacted", "changed_by": "@yuliia", "owner": "Max", "comment": "…",
 *   "next_contact": "2026-11-20", "lost_reason": "Задорого" }
 *
 * lead_id is the Meta leadgen id (with or without the "l:" prefix). status accepts a label
 * ("Follow-up"), a code ("follow_up") or a known alias. owner and comment are optional.
 */
export async function POST(request: NextRequest) {
  const token = process.env.LEADS_API_TOKEN ?? "";
  const given = (request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!token || given.length !== token.length || !timingSafeEqual(Buffer.from(given), Buffer.from(token))) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  let body: { lead_id?: unknown; status?: unknown; changed_by?: unknown; owner?: unknown; comment?: unknown; next_contact?: unknown; lost_reason?: unknown };
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
  const next = body.next_contact === undefined ? undefined : String(body.next_contact ?? "").trim() || null;
  if (next && !/^\d{4}-\d{2}-\d{2}$/.test(next)) return NextResponse.json({ ok: false, error: "next_contact must be YYYY-MM-DD" }, { status: 400 });
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

  await setLeadFields(lead.id, author, {
    status: status ?? undefined,
    owner: body.owner === undefined ? undefined : String(body.owner ?? "").trim() || null,
    nextContactAt: next,
    lostReason: body.lost_reason === undefined ? undefined : String(body.lost_reason ?? "").trim().slice(0, 200) || null,
  });
  const comment = String(body.comment ?? "").trim();
  if (comment) await addComment(lead.id, author, comment.slice(0, 4000));

  return NextResponse.json({ ok: true, lead: lead.id, status: status ?? lead.status });
}
