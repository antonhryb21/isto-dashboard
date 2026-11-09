import { NextResponse, type NextRequest } from "next/server";
import { and, eq, gte } from "drizzle-orm";
import { db } from "@/db";
import { syncRuns } from "@/db/schema";
import { runSync, type SyncKind } from "@/lib/sync";
import { sendDigest } from "@/lib/digest";
import { telegramEnabled } from "@/lib/telegram";
import { aiEnabled, generateInsights } from "@/lib/ai/insights";

export const maxDuration = 300;

/**
 * Called by Vercel Cron (see vercel.json). Vercel sends `Authorization: Bearer $CRON_SECRET`.
 * ?kind=quick|daily|backfill (&months=N for backfill).
 */
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const kind = (request.nextUrl.searchParams.get("kind") ?? "daily") as SyncKind;

  // Morning run at 09:30 Kyiv. Vercel schedules are UTC and know nothing about summer time, so two
  // schedules exist (06:30 and 07:30 UTC) and only the one that falls in Kyiv's 9 o'clock hour runs.
  // A second call on the same Kyiv day (the other schedule, an n8n trigger) is skipped.
  if (request.nextUrl.searchParams.get("slot") === "kyiv-0930") {
    const now = new Date();
    const kyivHour = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Kyiv", hour: "2-digit", hour12: false }).format(now));
    if (kyivHour !== 9) return NextResponse.json({ skipped: `Kyiv hour is ${kyivHour}, not 9` });
    const kyivMidnight = new Date(now.getTime() - (kyivMinutesOfDay(now) * 60_000));
    const [done] = await db
      .select({ id: syncRuns.id })
      .from(syncRuns)
      .where(and(eq(syncRuns.kind, "daily"), gte(syncRuns.startedAt, kyivMidnight)))
      .limit(1);
    if (done) return NextResponse.json({ skipped: "already ran today" });
  }
  if (!["quick", "daily", "backfill"].includes(kind)) return NextResponse.json({ error: "bad kind" }, { status: 400 });
  const months = Number(request.nextUrl.searchParams.get("months") ?? "12");
  const report = await runSync(kind, { months });
  // AI insights on fresh numbers, before the Telegram summary so it can include them.
  let insights: string | null = null;
  if (kind === "daily" && aiEnabled()) {
    insights = await generateInsights("cron").then(
      () => "ok",
      (e) => `failed: ${e instanceof Error ? e.message : e}`,
    );
  }
  // Morning Telegram summary after the daily sync (09:30 Kyiv), when the bot is configured.
  let digest: string | null = null;
  if (kind === "daily" && telegramEnabled()) {
    digest = await sendDigest().then(
      () => "sent",
      (e) => `failed: ${e instanceof Error ? e.message : e}`,
    );
  }
  return NextResponse.json({ kind, report, insights, digest });
}

function kyivMinutesOfDay(d: Date) {
  const [h, m] = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Kyiv", hour: "2-digit", minute: "2-digit", hour12: false })
    .format(d)
    .split(":")
    .map(Number);
  return (h % 24) * 60 + m;
}
