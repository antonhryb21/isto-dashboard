import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { leadSources, leads, type Lead } from "@/db/schema";
import { NON_LEAD_TABS } from "@/lib/config";
import { detectRegion, listRegions } from "@/lib/regions";
import { upsertLead, type IncomingLead } from "@/lib/leads";
import { STATUS_BY_CODE, type StatusCode } from "@/lib/statuses";
import { appendRow, listTabs, readTab, writeCells } from "./client";

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

const strip = (v: string | undefined) => (v ?? "").trim().replace(/^(l|ag|as|c|f|p):/, "") || null;

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

// ---------- Import (sheet → database) ----------

/** Make sure every lead tab of the configured spreadsheets has a lead_sources row. */
export async function discoverSources(spreadsheetId: string, regionCode: string | null, historySheetName: string | null) {
  const tabs = await listTabs(spreadsheetId);
  for (const tab of tabs) {
    const lower = tab.toLowerCase();
    if (NON_LEAD_TABS.some((n) => lower.startsWith(n))) continue;
    if (historySheetName && tab === historySheetName) continue;
    await db
      .insert(leadSources)
      .values({ spreadsheetId, sheetName: tab, regionCode, historySheetName })
      .onConflictDoNothing();
  }
}

export async function importSource(source: typeof leadSources.$inferSelect) {
  const allRegions = await listRegions();
  const rows = await readTab(source.spreadsheetId, source.sheetName);
  if (rows.length < 2) return { created: 0, updated: 0, skipped: true };
  const map = mapColumns(rows[0]);
  // A tab without an id or a phone/email column isn't a lead list (e.g. a pivot).
  if (map.fields.id === undefined && map.fields.phone === undefined && map.fields.email === undefined) {
    return { created: 0, updated: 0, skipped: true };
  }

  let created = 0;
  let updated = 0;
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    const get = (f: Field) => (map.fields[f] !== undefined ? row[map.fields[f]!] : undefined);
    const phone = strip(get("phone"));
    const email = get("email")?.trim() || null;
    const id = strip(get("id"));
    if (!id && !phone && !email) continue;

    const createdTime = parseDate(get("created_time")) ?? new Date();
    const answers: Record<string, string> = {};
    for (const q of map.questions) {
      const v = row[q.index]?.trim();
      if (v) answers[q.label] = v;
    }
    const campaignName = get("campaign_name")?.trim() || null;
    const formName = get("form_name")?.trim() || null;

    const incoming: IncomingLead = {
      metaLeadId: id ?? `sheet:${source.spreadsheetId}:${source.sheetName}:${phone ?? email}`,
      createdTime,
      regionCode: source.regionCode ?? detectRegion(allRegions, campaignName, formName, source.sheetName),
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
      sourceId: source.id,
      sheetRow: r + 1,
      statusRaw: map.fields.status !== undefined ? (get("status")?.trim() ?? "") : undefined,
      owner: get("owner")?.trim() || null,
      sheetComment:
        map.comments
          .map((i) => row[i]?.trim())
          .filter(Boolean)
          .join("\n") || null,
    };
    const res = await upsertLead(incoming, "sheet");
    if (res === "created") created++;
    if (res === "updated") updated++;
  }
  await db.update(leadSources).set({ lastSyncedAt: new Date(), lastError: null }).where(eq(leadSources.id, source.id));
  return { created, updated, skipped: false };
}

export async function importAllSources() {
  const sources = await db.select().from(leadSources).where(eq(leadSources.enabled, true));
  const result: Record<string, unknown> = {};
  for (const s of sources) {
    try {
      result[`${s.sheetName}`] = await importSource(s);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await db.update(leadSources).set({ lastError: msg.slice(0, 500) }).where(eq(leadSources.id, s.id));
      result[`${s.sheetName}`] = { error: msg };
    }
  }
  return result;
}

// ---------- Write-back (CRM → sheet) ----------

/**
 * Write a CRM change to the lead's row. The row is looked up by lead id at write time,
 * because people sort and insert rows in the sheet.
 */
export async function writeBackLead(
  lead: Lead,
  change: { status?: StatusCode; owner?: string | null; previousStatus?: string },
  author: string,
): Promise<{ ok: boolean; message?: string }> {
  if (!lead.sourceId) return { ok: false, message: "Лід не прив'язаний до таблиці" };
  const [source] = await db.select().from(leadSources).where(eq(leadSources.id, lead.sourceId)).limit(1);
  if (!source) return { ok: false, message: "Джерело ліда не знайдено" };

  const rows = await readTab(source.spreadsheetId, source.sheetName);
  const map = mapColumns(rows[0] ?? []);
  const idCol = map.fields.id;
  let rowNumber: number | null = null;
  if (idCol !== undefined && lead.metaLeadId && !lead.metaLeadId.startsWith("sheet:")) {
    const i = rows.findIndex((r, idx) => idx > 0 && strip(r[idCol]) === lead.metaLeadId);
    if (i > 0) rowNumber = i + 1;
  }
  if (!rowNumber && lead.sheetRow && rows[lead.sheetRow - 1]) rowNumber = lead.sheetRow;
  if (!rowNumber) return { ok: false, message: "Рядок ліда в таблиці не знайдено" };

  const now = new Date();
  const stamp = formatStamp(now);
  const cells: { row: number; col: number; value: string }[] = [];
  if (change.status && map.fields.status !== undefined) {
    cells.push({ row: rowNumber, col: map.fields.status, value: STATUS_BY_CODE[change.status].label });
    const header = (rows[0] ?? []).map((h) => h.trim().toLowerCase());
    const at = header.indexOf("status_updated_at");
    const by = header.indexOf("status_updated_by");
    if (at >= 0) cells.push({ row: rowNumber, col: at, value: stamp });
    if (by >= 0) cells.push({ row: rowNumber, col: by, value: author });
  }
  if (change.owner !== undefined && map.fields.owner !== undefined) {
    cells.push({ row: rowNumber, col: map.fields.owner, value: change.owner ?? "" });
  }
  await writeCells(source.spreadsheetId, source.sheetName, cells);

  if (change.status && source.historySheetName) {
    await appendRow(source.spreadsheetId, source.historySheetName, [
      stamp,
      author,
      change.previousStatus ? (STATUS_BY_CODE[change.previousStatus as StatusCode]?.label ?? change.previousStatus) : "",
      STATUS_BY_CODE[change.status].label,
      source.spreadsheetId,
      source.sheetName,
      String(rowNumber),
      "",
    ]);
  }
  await db.update(leads).set({ sheetRow: rowNumber }).where(eq(leads.id, lead.id));
  return { ok: true };
}

/** "dd/MM/yyyy HH:mm:ss" in Kyiv time, matching the existing history tab. */
function formatStamp(d: Date) {
  const p = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Kyiv",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(d);
  const g = (t: string) => p.find((x) => x.type === t)?.value ?? "";
  return `${g("day")}/${g("month")}/${g("year")} ${g("hour")}:${g("minute")}:${g("second")}`;
}
