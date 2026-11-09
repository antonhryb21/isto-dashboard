import type { IncomingLead } from "@/lib/leads";
import { detectRegion, type Region } from "@/lib/regions";

// ---------- Column mapping ----------

type Field =
  | "id" | "created_time" | "ad_id" | "ad_name" | "adset_id" | "adset_name" | "campaign_id" | "campaign_name"
  | "form_id" | "form_name" | "is_organic" | "platform" | "full_name" | "phone" | "email" | "city"
  | "status" | "owner" | "comment" | "status_updated_at" | "status_updated_by";

const EXACT: Record<string, Field> = {
  id: "id", lead_id: "id", "lead id": "id",
  created_time: "created_time", "created time": "created_time",
  ad_id: "ad_id", ad_name: "ad_name", adset_id: "adset_id", adset_name: "adset_name",
  campaign_id: "campaign_id", campaign_name: "campaign_name", form_id: "form_id", form_name: "form_name",
  is_organic: "is_organic", platform: "platform",
  full_name: "full_name", "full name": "full_name", "first name": "full_name", first_name: "full_name", name: "full_name",
  phone: "phone", phone_number: "phone", "phone number": "phone", "телефон": "phone",
  email: "email", "e-mail": "email",
  city: "city", "місто": "city",
  lead_status: "status", status: "status", "статус": "status",
  "new bizz": "owner", owner: "owner", "відповідальний": "owner", manager: "owner", "менеджер": "owner",
  status_updated_at: "status_updated_at", status_updated_by: "status_updated_by",
};

const IGNORE = [/^tg_/, /^clean_date$/, /^status_updated/, /^$/];

export type ColumnMap = {
  fields: Partial<Record<Field, number>>;
  comments: number[];
  questions: { index: number; label: string }[];
};

export function mapColumns(header: string[]): ColumnMap {
  const fields: ColumnMap["fields"] = {};
  const comments: number[] = [];
  const questions: ColumnMap["questions"] = [];
  header.forEach((raw, i) => {
    const h = raw.trim().toLowerCase();
    const f = EXACT[h];
    if (f && fields[f] === undefined) {
      fields[f] = i;
      return;
    }
    if (h.includes("comment") || h.includes("мент")) {
      comments.push(i);
      return;
    }
    if (IGNORE.some((r) => r.test(h))) return;
    if (!f) questions.push({ index: i, label: raw.trim().replace(/[_:?]+$/g, "").replace(/_/g, " ") });
  });
  return { fields, comments, questions };
}

export const strip = (v: string | undefined) => (v ?? "").trim().replace(/^(l|ag|as|c|f|p):/, "") || null;

function parseDate(v: string | undefined): Date | null {
  if (!v) return null;
  const iso = new Date(v);
  if (!Number.isNaN(iso.getTime()) && /\d{4}-\d{2}-\d{2}/.test(v)) return iso;
  const m = v.match(/^(\d{1,2})[./](\d{1,2})[./](\d{2,4})/);
  if (m) {
    const y = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
    return new Date(Date.UTC(y, Number(m[2]) - 1, Number(m[1])));
  }
  return null;
}


/** True when a header row looks like a lead list (has an id, phone or email column). */
export function isLeadTable(map: ColumnMap) {
  return map.fields.id !== undefined || map.fields.phone !== undefined || map.fields.email !== undefined;
}

/**
 * Convert one sheet/CSV row to a lead. Returns null for empty rows.
 * `fallbackKey` makes an id for rows without a Meta lead id (e.g. website leads).
 */
export function rowToLead(
  map: ColumnMap,
  row: string[],
  opts: { regions: Region[]; regionCode: string | null; tabName: string; fallbackKey: string },
): IncomingLead | null {
  const get = (f: Field) => (map.fields[f] !== undefined ? row[map.fields[f]!] : undefined);
  const phone = strip(get("phone"));
  const email = get("email")?.trim() || null;
  const id = strip(get("id"));
  if (!id && !phone && !email) return null;

  const answers: Record<string, string> = {};
  for (const q of map.questions) {
    const v = row[q.index]?.trim();
    if (v) answers[q.label] = v;
  }
  const campaignName = get("campaign_name")?.trim() || null;
  const formName = get("form_name")?.trim() || null;

  return {
    metaLeadId: id ?? `sheet:${opts.fallbackKey}:${phone ?? email}`,
    createdTime: parseDate(get("created_time")) ?? new Date(),
    regionCode: opts.regionCode ?? detectRegion(opts.regions, campaignName, formName, opts.tabName),
    platform: get("platform")?.trim().toLowerCase() || null,
    isOrganic: get("is_organic")?.trim().toLowerCase() === "true",
    campaignId: strip(get("campaign_id")),
    campaignName,
    adsetId: strip(get("adset_id")),
    adsetName: get("adset_name")?.trim() || null,
    adId: strip(get("ad_id")),
    adName: get("ad_name")?.trim() || null,
    formId: strip(get("form_id")),
    formName,
    fullName: get("full_name")?.trim() || null,
    phone,
    email,
    city: get("city")?.trim() || null,
    answers,
    statusRaw: map.fields.status !== undefined ? (get("status")?.trim() ?? "") : undefined,
    owner: get("owner")?.trim() || null,
    sheetComment:
      map.comments
        .map((i) => row[i]?.trim())
        .filter(Boolean)
        .join("\n") || null,
  };
}
