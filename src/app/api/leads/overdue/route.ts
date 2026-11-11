import { NextResponse, type NextRequest } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { SLA_MINUTES } from "@/lib/config";
import { dueFollowUps, overdueLeads } from "@/lib/queries";
import { businessMinutes, isWorkingTime } from "@/lib/sla";

export const dynamic = "force-dynamic";

/**
 * For the Telegram bot (n8n) to remind the team on a timer, e.g. every 15 minutes:
 * leads still in "New" past the response target (working time) and follow-ups due today.
 *
 * GET /api/leads/overdue
 * Authorization: Bearer <LEADS_API_TOKEN>
 */
export async function GET(request: NextRequest) {
  const token = process.env.LEADS_API_TOKEN ?? "";
  const given = (request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!token || given.length !== token.length || !timingSafeEqual(Buffer.from(given), Buffer.from(token))) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  const [overdue, due] = await Promise.all([overdueLeads(), dueFollowUps()]);
  const app = process.env.APP_URL ?? "";
  return NextResponse.json({
    ok: true,
    working_time: isWorkingTime(),
    sla_minutes: SLA_MINUTES,
    overdue: overdue.map((l) => ({
      id: l.id,
      name: l.fullName,
      region: l.regionCode,
      owner: l.owner,
      waiting_work_minutes: businessMinutes(l.createdTime),
      url: `${app}/crm/${l.id}`,
    })),
    follow_ups: due.map((l) => ({ id: l.id, name: l.fullName, region: l.regionCode, owner: l.owner, date: l.nextContactAt, url: `${app}/crm/${l.id}` })),
  });
}
