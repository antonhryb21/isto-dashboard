import "server-only";
import { META } from "@/lib/config";
import { detectRegion, listRegions } from "@/lib/regions";
import { upsertLead } from "@/lib/leads";
import { leadContact } from "@/lib/lead-contact";
import { graphAllAsPage, graphAsPage, graphPost, pageToken } from "./client";

type FieldData = { name: string; values?: string[] | null };
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
  let formName: string | null = null;
  if (l.form_id) {
    try {
      formName = (await graphAsPage<{ name?: string }>(l.form_id, { fields: "name" })).name ?? null;
    } catch {
      /* form name is nice-to-have */
    }
  }
  const allRegions = await listRegions();
  return upsertLead(toIncoming(l, formName, allRegions), "meta");
}

/** Subscribe the ISTO Page to leadgen events for our app (one-time; safe to repeat). */
export async function subscribePageToLeadgen() {
  // Page subscriptions must be made with a Page access token.
  return graphPost(`${META.pageId}/subscribed_apps`, { subscribed_fields: "leadgen" }, await pageToken());
}

type FormLead = ApiLead;

/**
 * Pull leads straight from the Page's lead forms. Safety net for missed webhooks (daily)
 * and the way to load the last ~90 days on first run. Existing leads are left as they are.
 */
export async function syncMetaLeads(sinceDays: number) {
  const since = Math.floor((Date.now() - sinceDays * 86_400_000) / 1000);
  const forms = await graphAllAsPage<{ id: string; name?: string; status?: string }>(`${META.pageId}/leadgen_forms`, {
    fields: "id,name,status",
    limit: 100,
  });
  const allRegions = await listRegions();
  let created = 0;
  const failed: string[] = [];
  for (const form of forms) {
    let list: FormLead[];
    try {
      list = await graphAllAsPage<FormLead>(
        `${form.id}/leads`,
        {
          fields: "id,created_time,ad_id,ad_name,adset_id,adset_name,campaign_id,campaign_name,form_id,platform,is_organic,field_data",
          filtering: JSON.stringify([{ field: "time_created", operator: "GREATER_THAN", value: since }]),
          limit: 100,
        },
        5000,
      );
    } catch (e) {
      failed.push(`${form.name ?? form.id}: ${e instanceof Error ? e.message : e}`);
      continue;
    }
    // One odd lead must not stop the rest.
    for (const l of list) {
      try {
        const res = await upsertLead(toIncoming(l, form.name ?? null, allRegions), "meta");
        if (res === "created") created++;
      } catch (e) {
        failed.push(`lead ${l.id}: ${e instanceof Error ? e.message : e}`);
      }
    }
  }
  if (failed.length && created === 0 && failed.length >= forms.length) throw new Error(failed.slice(0, 3).join(" · "));
  return { forms: forms.length, created, ...(failed.length ? { failedItems: failed.length, firstProblem: failed[0].slice(0, 200) } : {}) };
}

function toIncoming(l: ApiLead, formName: string | null, allRegions: Awaited<ReturnType<typeof listRegions>>) {
  // Some question types come without `values` (e.g. consent checkboxes): treat them as empty.
  const fields = Object.fromEntries((l.field_data ?? []).map((f) => [f.name, (f.values ?? []).filter(Boolean).join(", ")]));
  const pick = (keys: string[]) => keys.map((k) => fields[k]).find(Boolean) ?? null;
  const used = new Set(Object.values(CONTACT).flat());
  const answers = Object.fromEntries(
    Object.entries(fields)
      .filter(([k]) => !used.has(k))
      .map(([k, v]) => [k.replace(/[_:?]+$/g, "").replace(/_/g, " "), v]),
  );
  // Custom questions ("Your name", "Country") are recognised too; see lead-contact.ts.
  const c = leadContact({ fullName: pick(CONTACT.full_name), phone: pick(CONTACT.phone), email: pick(CONTACT.email), city: pick(CONTACT.city), answers });
  return {
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
    fullName: c.name,
    phone: c.phone,
    email: c.email,
    city: c.city,
    answers: c.interest,
  };
}
