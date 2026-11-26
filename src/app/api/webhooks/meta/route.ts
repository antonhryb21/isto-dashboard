import { NextResponse, type NextRequest } from "next/server";
import { createHmac, timingSafeEqual } from "node:crypto";
import { after } from "next/server";
import { ingestLead } from "@/lib/meta/leadgen";
import { recordConversationWith } from "@/lib/meta/direct";

/** Meta calls GET once to verify the webhook URL. */
export function GET(request: NextRequest) {
  const p = request.nextUrl.searchParams;
  // Trimmed on both sides: a space pasted along with the value in Vercel must not break verification.
  const expected = process.env.META_WEBHOOK_VERIFY_TOKEN?.trim();
  if (p.get("hub.mode") === "subscribe" && expected && p.get("hub.verify_token")?.trim() === expected) {
    return new NextResponse(p.get("hub.challenge") ?? "", { status: 200 });
  }
  return new NextResponse("forbidden", { status: 403 });
}

type LeadgenPayload = {
  object: string;
  entry?: {
    id?: string;
    changes?: { field: string; value: { leadgen_id?: string } }[];
    /** Instagram direct messages (object "instagram"). */
    messaging?: { sender?: { id?: string }; recipient?: { id?: string }; message?: { is_echo?: boolean } }[];
  }[];
};

/** New lead from a Meta lead form. Signature is checked with the app secret. */
export async function POST(request: NextRequest) {
  const raw = await request.text();
  const secret = process.env.META_APP_SECRET ?? "";
  const sig = request.headers.get("x-hub-signature-256") ?? "";
  const expected = "sha256=" + createHmac("sha256", secret).update(raw).digest("hex");
  if (!secret || sig.length !== expected.length || !timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) {
    return new NextResponse("bad signature", { status: 401 });
  }

  const body = JSON.parse(raw) as LeadgenPayload;
  const ids = (body.entry ?? [])
    .flatMap((e) => e.changes ?? [])
    .filter((c) => c.field === "leadgen" && c.value.leadgen_id)
    .map((c) => c.value.leadgen_id!);

  // Someone wrote to the Instagram account: record their conversation (our own replies are echoes).
  const writers = [
    ...new Set(
      (body.object === "instagram" ? (body.entry ?? []) : [])
        .flatMap((e) => e.messaging ?? [])
        .filter((m) => m.message && !m.message.is_echo && m.sender?.id)
        .map((m) => m.sender!.id!),
    ),
  ];

  // Answer Meta immediately; fetch lead details after the response is sent.
  after(async () => {
    for (const id of writers) {
      try {
        await recordConversationWith(id);
      } catch (e) {
        console.error("direct conversation lookup failed", id, e);
      }
    }
    for (const id of ids) {
      try {
        await ingestLead(id);
      } catch (e) {
        console.error("leadgen ingest failed", id, e);
      }
    }
  });
  return NextResponse.json({ received: ids.length, messages: writers.length });
}
