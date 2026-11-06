import "server-only";
import { META } from "@/lib/config";
import { detectRegion, listRegions } from "@/lib/regions";
import { upsertLead } from "@/lib/leads";
import { graphAsPage, graphPost, pageToken } from "./client";

type FieldData = { name: string; values: string[] };
type ApiLead = {
  id: string;
  created_time: string;
  ad_id?: string;
  ad_name?: string;
  adset_id?: string;
  adset_name?: string;
  campaign_id?: string;
  campaign_name?: string;
  form_id?: string;
  platform?: string;
  is_organic?: boolean;
  field_data?: FieldData[];
};

const CONTACT = {
  full_name: ["full_name", "first_name", "name"],
  phone: ["phone_number", "phone"],
  email: ["email"],
  city: ["city"],
};

/** Fetch one lead by its leadgen id (from the webhook) and store it. */
export async function ingestLead(leadgenId: string) {
  const l = await graphAsPage<ApiLead>(leadgenId, {
    fields:
      "id,created_time,ad_id,ad_name,adset_id,adset_name,campaign_id,campaign_name,form_id,platform,is_organic,field_data",
  });
  const fields = Object.fromEntries((l.field_data ?? []).map((f) => [f.name, f.values.join(", ")]));
  const pick = (keys: string[]) => keys.map((k) => fields[k]).find(Boolean) ?? null;
  const used = new Set(Object.values(CONTACT).flat());
  const answers = Object.fromEntries(
    Object.entries(fields)
      .filter(([k]) => !used.has(k))
      .map(([k, v]) => [k.replace(/[_:?]+$/g, "").replace(/_/g, " "), v]),
  );

  let formName: string | null = null;
  if (l.form_id) {
    try {
      formName = (await graphAsPage<{ name?: string }>(l.form_id, { fields: "name" })).name ?? null;
    } catch {
      /* form name is nice-to-have */
    }
  }
  const allRegions = await listRegions();
  return upsertLead(
    {
      metaLeadId: l.id,
      createdTime: new Date(l.created_time),
      regionCode: detectRegion(allRegions, l.campaign_name, l.adset_name, formName),
      platform: l.platform ?? null,
      isOrganic: !!l.is_organic,
      campaignId: l.campaign_id ?? null,
      campaignName: l.campaign_name ?? null,
      adsetId: l.adset_id ?? null,
      adsetName: l.adset_name ?? null,
      adId: l.ad_id ?? null,
      adName: l.ad_name ?? null,
      formId: l.form_id ?? null,
      formName,
      fullName: pick(CONTACT.full_name),
      phone: pick(CONTACT.phone),
      email: pick(CONTACT.email),
      city: pick(CONTACT.city),
      answers,
    },
    "meta",
  );
}

/** Subscribe the ISTO Page to leadgen events for our app (one-time; safe to repeat). */
export async function subscribePageToLeadgen() {
  // Page subscriptions must be made with a Page access token.
  return graphPost(`${META.pageId}/subscribed_apps`, { subscribed_fields: "leadgen" }, await pageToken());
}
