import { NextResponse, type NextRequest } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { parseWebsiteLead } from "@/lib/website-lead";
import { saveWebsiteLead } from "@/lib/website-leads";

export const dynamic = "force-dynamic";

/**
 * A website form lead, sent by n8n after the site's form webhook (Contact Form 7).
 * Which forms reach the CRM is decided in n8n (e.g. the Vacancy form is left out).
 *
 * POST /api/leads/website
 * Authorization: Bearer <LEADS_API_TOKEN>
 * Body: see `src/lib/website-lead.ts`.
 * Answer: { ok, id, created, url, card_id }. The same submission_id sent twice gives created: false.
 * card_id ("w:<id>") is what the bot puts in its status buttons and sends to /api/leads/status.
 */
export async function POST(request: NextRequest) {
  const token = process.env.LEADS_API_TOKEN ?? "";
  const given = (request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!token || given.length !== token.length || !timingSafeEqual(Buffer.from(given), Buffer.from(token))) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "body must be JSON" }, { status: 400 });
  }

  const parsed = parseWebsiteLead(body);
  if (!parsed.ok) return NextResponse.json({ ok: false, error: parsed.error }, { status: 400 });

  const { id, created, deleted } = await saveWebsiteLead(parsed.lead);
  if (deleted) return NextResponse.json({ ok: true, id: null, created: false, deleted: true });
  return NextResponse.json({ ok: true, id, created, url: `${process.env.APP_URL ?? ""}/crm/${id}`, card_id: `w:${id}` });
}
