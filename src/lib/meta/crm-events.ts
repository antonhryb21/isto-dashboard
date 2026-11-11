import "server-only";
import { createHmac } from "node:crypto";
import { META } from "@/lib/config";
import type { StatusCode } from "@/lib/statuses";

/**
 * Sends lead stages back to Meta (Conversions API for CRM), so that campaigns can be optimised for
 * leads that turn out to be real instead of the cheapest form fills.
 *
 * Off until META_CRM_DATASET_ID (the dataset / pixel connected to the lead forms in Events Manager) is set.
 * Only the Meta lead id and the stage are sent: no name, phone or email.
 */
const STAGE: Partial<Record<StatusCode, string>> = {
  contacted: "Contacted",
  follow_up: "Contacted",
  meeting: "Meeting",
  proposal: "Proposal sent",
  won: "Won",
  not_relevant: "Not relevant",
  spam: "Not relevant",
  supplier: "Not relevant",
  lost: "Lost",
};

export const crmEventsEnabled = () => Boolean(process.env.META_CRM_DATASET_ID && process.env.META_SYSTEM_USER_TOKEN);

function proof(token: string) {
  const secret = process.env.META_APP_SECRET;
  return secret ? createHmac("sha256", secret).update(token).digest("hex") : null;
}

/**
 * Read-only check that the dataset id is right and the token can reach it.
 * Sends nothing, so it never pollutes Meta's data with a test stage.
 */
export async function checkCrmDataset(): Promise<{ ok: boolean; name?: string; error?: string }> {
  const dataset = process.env.META_CRM_DATASET_ID;
  const token = process.env.META_SYSTEM_USER_TOKEN;
  if (!dataset) return { ok: false, error: "META_CRM_DATASET_ID не задано" };
  if (!token) return { ok: false, error: "META_SYSTEM_USER_TOKEN не задано" };
  const params = new URLSearchParams({ access_token: token, fields: "id,name,owner_business" });
  const p = proof(token);
  if (p) params.set("appsecret_proof", p);
  try {
    const res = await fetch(`https://graph.facebook.com/${META.apiVersion}/${dataset}?${params}`, { cache: "no-store" });
    const json = (await res.json()) as { id?: string; name?: string; error?: { message?: string } };
    if (json.error) return { ok: false, error: json.error.message ?? "Meta відхилила запит" };
    return { ok: true, name: json.name ?? json.id };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "немає звʼязку з Meta" };
  }
}

export async function sendLeadStage(metaLeadId: string | null, status: StatusCode) {
  const dataset = process.env.META_CRM_DATASET_ID;
  const token = process.env.META_SYSTEM_USER_TOKEN;
  const stage = STAGE[status];
  if (!dataset || !token || !stage || !metaLeadId || !/^\d{10,20}$/.test(metaLeadId)) return { sent: false as const };

  const body = new URLSearchParams({
    access_token: token,
    data: JSON.stringify([
      {
        event_name: stage,
        event_time: Math.floor(Date.now() / 1000),
        action_source: "system_generated",
        custom_data: { event_source: "crm", lead_event_source: "ISTO Dashboard" },
        user_data: { lead_id: Number(metaLeadId) },
      },
    ]),
  });
  const p = proof(token);
  if (p) body.set("appsecret_proof", p);
  try {
    const res = await fetch(`https://graph.facebook.com/${META.apiVersion}/${dataset}/events`, { method: "POST", body, cache: "no-store" });
    const json = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
    if (json.error) {
      console.warn("[crm-events] Meta rejected the event:", json.error.message);
      return { sent: false as const, error: json.error.message };
    }
    return { sent: true as const };
  } catch (e) {
    console.warn("[crm-events] failed:", e instanceof Error ? e.message : e);
    return { sent: false as const };
  }
}
