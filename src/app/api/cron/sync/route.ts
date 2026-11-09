import { NextResponse, type NextRequest } from "next/server";
import { runSync, type SyncKind } from "@/lib/sync";
import { sendDigest } from "@/lib/digest";
import { telegramEnabled } from "@/lib/telegram";

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
  if (!["quick", "daily", "backfill"].includes(kind)) return NextResponse.json({ error: "bad kind" }, { status: 400 });
  const months = Number(request.nextUrl.searchParams.get("months") ?? "12");
  const report = await runSync(kind, { months });
  // Morning Telegram summary after the daily sync (07:00 Dubai), when the bot is configured.
  let digest: string | null = null;
  if (kind === "daily" && telegramEnabled()) {
    digest = await sendDigest().then(
      () => "sent",
      (e) => `failed: ${e instanceof Error ? e.message : e}`,
    );
  }
  return NextResponse.json({ kind, report, digest });
}
